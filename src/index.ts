import * as net from "net";
import * as rx from "rxjs";
import { map, flatMap, scan, tap, filter } from "rxjs/operators";
import { OrderedMap } from "immutable";

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
  REGISTERED = "REGISTERED", // Successfully registered
  UNREGISTERED = "UNREGISTERED", // Successfully unregistered
  EXISTING = "EXISTING", // Cannot register: already exists
  NONEXISTING = "NONEXISTING", // Cannot unregister: does not exist
  INVALID = "INVALID", // Invalid request pass-through
  NONE = "NONE" // Used by the initial state of peerTable reducer
}

type Peer = { host: string; port: number };
type PeerTable = OrderedMap<string, Peer>;

function updatePeerTable(
  {
    peerTable
  }: {
    status: PeerStatus;
    peerTable: PeerTable;
    socket: net.Socket;
  },
  { request, socket }: { request: IRequest; socket: net.Socket }
) {
  const result = { status: PeerStatus.NONE, peerTable, socket };

  switch (request.type) {
    case RequestType.REG:
      if (peerTable.has(request.username)) {
        result.status = PeerStatus.EXISTING;
        break;
      }

      result.peerTable = peerTable.set(request.username, {
        host: request.host,
        port: request.port
      });
      result.status = PeerStatus.REGISTERED;
      break;

    case RequestType.UNREG:
      if (!peerTable.has(request.username)) {
        result.status = PeerStatus.NONEXISTING;
        break;
      }

      result.peerTable = peerTable.delete(request.username);
      result.status = PeerStatus.UNREGISTERED;
      break;

    default:
      result.status = PeerStatus.INVALID;
      break;
  }

  return result;
}

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

const localPort = Number(process.argv[2]);
server.listen(
  isNaN(localPort) || localPort < 1024 || localPort > 65535 ? 5000 : localPort
);

const socket$ = rx.fromEvent(server, "connection") as rx.Observable<net.Socket>;
const response$ = socket$.pipe(
  flatMap(socket =>
    (rx.fromEvent(socket, "data") as rx.Observable<Buffer | string>).pipe(
      map(data => ({ data: data.toString(), socket }))
    )
  ),

  map(({ data, socket }) => ({ request: parseRequestString(data), socket })),

  scan(updatePeerTable, {
    status: PeerStatus.NONE,
    socket: undefined,
    peerTable: OrderedMap() as PeerTable
  }),

  map(composeMessage),

  filter(({ response }) => Boolean(response)),

  tap(({ socket, response }) =>
    console.log(
      `\x1b[0m\x1b[32m${socket.localAddress}:${
        socket.localPort
      }\x1b[0m sent \x1b[34m${response}\x1b[0m to \x1b[32m${
        socket.remoteAddress
      }:${socket.remotePort}\x1b[0m`
    )
  )
);

const subscription = response$.subscribe(sendReply);
