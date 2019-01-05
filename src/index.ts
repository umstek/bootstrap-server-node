import * as net from "net";
import * as rx from "rxjs";
import { map, flatMap, scan, tap } from "rxjs/operators";
import { OrderedMap } from "immutable";

const server = net.createServer({ allowHalfOpen: true });

server.on("listening", () => {
  console.log("Server started: ");
  console.log(server.address());
});
server.on("error", error => console.error(error.message));
server.on("close", () => {
  console.log("Server closed: ");
  console.log(server.address());
});

const socket$ = rx.fromEvent(server, "connection") as rx.Observable<net.Socket>;
const text$ = socket$.pipe(
  tap(() => console.log("----------")),
  tap(socket => console.log(socket.address())),
  flatMap(socket =>
    (rx.fromEvent(socket, "data") as rx.Observable<Buffer | string>).pipe(
      map(data => ({ data: data.toString(), socket }))
    )
  )
);

enum RequestType {
  INVALID = "INVALID",
  REG = "REG",
  UNREG = "UNREG"
}

interface IRequest {
  type: RequestType;
  host?: string;
  port?: number;
  username?: string;
}

function parseRequestString(text: string): IRequest {
  if (!text || text.length <= 0) {
    return { type: RequestType.INVALID };
  }

  const parts = text.split(/\s+/);
  // 0016 REG HOST PORT USERNAME
  if (parts.length !== 5) {
    return { type: RequestType.INVALID };
  }

  // Assume host address is valid

  const port = Number(parts[3]);
  if (isNaN(port)) {
    return { type: RequestType.INVALID };
  }

  return {
    type: (RequestType[parts[1]] || RequestType.INVALID) as RequestType,
    host: parts[2],
    port,
    username: parts[4]
  };
}

enum PeerStatus {
  REGISTERED = "REGISTERED",
  UNREGISTERED = "UNREGISTERED",
  EXISTING = "EXISTING",
  NONEXISTING = "NONEXISTING",
  INVALID = "INVALID",
  NONE = "NONE"
}

type PeerTable = OrderedMap<string, { host: string; port: number }>;

function updatePeerTable(
  {
    peerTable: oldPeerTable
  }: {
    status: PeerStatus;
    peerTable: PeerTable;
    socket: net.Socket;
  },
  { request, socket }: { request: IRequest; socket: net.Socket }
) {
  switch (request.type) {
    case RequestType.REG:
      if (oldPeerTable.has(request.username)) {
        return { peerTable: oldPeerTable, status: PeerStatus.EXISTING, socket };
      }
      return {
        peerTable: oldPeerTable.set(request.username, {
          host: request.host,
          port: request.port
        }),
        status: PeerStatus.REGISTERED,
        socket
      };

    case RequestType.UNREG:
      if (!oldPeerTable.has(request.username)) {
        return {
          peerTable: oldPeerTable,
          status: PeerStatus.NONEXISTING,
          socket
        };
      }
      return {
        peerTable: oldPeerTable.delete(request.username),
        status: PeerStatus.UNREGISTERED,
        socket
      };

    default:
      return {
        peerTable: oldPeerTable,
        status: PeerStatus.INVALID,
        socket
      };
  }
}

const request$ = text$.pipe(
  tap(({ data }) => console.log(data)),
  map(({ data, socket }) => ({ request: parseRequestString(data), socket }))
);
const peerTable$ = request$.pipe(
  tap(({ request }) => console.log(request)),
  scan(updatePeerTable, {
    status: PeerStatus.NONE,
    socket: undefined,
    peerTable: OrderedMap() as PeerTable
  })
);

function composeMessage({
  status,
  socket,
  peerTable
}: {
  status: PeerStatus;
  socket: net.Socket;
  peerTable: PeerTable;
}): { socket: net.Socket; response: string } {
  switch (status) {
    case PeerStatus.REGISTERED:
      const peerList = peerTable
        .take(peerTable.size - 1) // Exclude self
        .entrySeq()
        .map(([key, { host, port }]) => `${host} ${port} ${key}`)
        .join(" ");
      return {
        socket,
        response:
          peerList.length > 0
            ? `${(peerList.length + 11)
                .toString()
                .padStart(4, "0")} REGOK ${peerList}`
            : "0010 REGOK"
      };

    case PeerStatus.EXISTING:
      return { socket, response: "0015 REGOK 9999" };

    case PeerStatus.UNREGISTERED:
      return { socket, response: "0012 UNROK 0" };

    case PeerStatus.NONEXISTING:
      return { socket, response: "0015 UNROK 9999" };

    case PeerStatus.INVALID:
      return { socket, response: "0010 ERROR" };

    default:
      // PeerStatus.NONE
      return { socket, response: null };
  }
}

const response$ = peerTable$.pipe(
  tap(({ status, peerTable }) =>
    console.log(
      `${status} ${peerTable.map(({ host, port }) => `${host}:${port}`).join()}`
    )
  ),
  map(composeMessage)
);

function sendReply({
  socket,
  response
}: {
  socket: net.Socket;
  response: string;
}) {
  socket.write(Buffer.from(response, "ascii"));
  socket.end();
}

server.listen(9000);

response$
  .pipe(tap(({ response }) => console.log(response)))
  .subscribe(sendReply);
