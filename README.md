## Setting-up

- Have `yarn` installed.
- Run `yarn start [port]` to try TypeScript version directly with `ts-node`.
- Run `yarn build` to build the project (into the build folder) so that it can be directly executed with node with `node index.js [port]`.

## How to use

### Port argument

The default port is 5000; this is assumed even if the given port number is invalid.

### Message format

Incoming messages must adhere to the following format:  
`0000 REG HOST PORT USERNAME`  
where `0000` should be replaced by the length of the message, including itself, padded to a fixed lenth of 4 with `0`s.

`REG` can be `REG` or `UNREG` depending on whether you want to register or unregister.

`HOST` is a v4 or v6 IP address; this field is not validated so may crash the server.

`PORT` is the port that will be _used by the P2P_ network: note that this can be different from what the peer uses to communicate with `bootstrap-server` (this one). (The reply for the `REG` message will be sent to the port that is used to communicate with this server.)

`USERNAME` must be unique for each peer; this will be used by the bootstrap server to identify peers.

Upon valid parsing of the registration request, the bootstrap server will add the peer name and location (ip:port) to its records, and the peer will be sent a success message with all the peers that have registered in the server before the communicating peer.  
E.g.:  
`0010 REGOK` if no peers have registered before.  
`0000 REGOK 192.168.1.3 3000 PEER1 192.168.1.4 3000 PEER2` if PEER1 and PEER2 have already registered. (0000 REGOK [ip port username]\*)

Following error messages are sent:  
if you (someone) have already registered with the same username: `0015 REGOK 9999`,  
if your request is not formatted correctly: `0010 ERROR`.

If you're trying to unregister, `0012 UNROK 0` will be sent on success. `0010 ERROR` will be the same for formatting errors or invalid messages. If there is no server with the name given, `0015 UNROK 9999` will be sent. Be careful that the server only checks for the username; i.e.: a peer can unregister another peer if the former knows the username of the latter.

_This program tries to maintain full compatibility with the original bootstrap server except:_

- The peer table is unlimited.
