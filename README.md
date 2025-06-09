<div align="center">

<img src="https://raw.githubusercontent.com/scherepi/conduit/main/.github/header.png" alt="Conduit">

<br>

<br>

[![][npm-shield]][npm-link]
[![][last-updated-shield]][npm-link]
</div>

<!-- for a divider line -->
<h1 align="center"></h1>


`conduit` is a smart utility for sharing local apps with the world, no server deployment or firewall wrangling necessary. It tunnels your local ports through NAT and firewalls, automatically adds HTTPS to your endpoints, and lets you show off your projects or test webhooks in seconds. Just run `conduit` and your machine is open for business (the fun kind).

**Try it out:**

```
bunx conduit-ws 3000
```

This will publicly expose `localhost:3000` on a random port on `conduit.ws`. Want a subdomain with HTTPS?

```
bunx conduit-ws 3000 -d foobar
```

This will connect your website directly to **https**://foobar.conduit.ws.

## Demo

<a href="https://asciinema.org/a/722341" target="_blank"><img src="https://asciinema.org/a/722341.svg" /></a>

## Installation

<!-- is bun a requirement? mention here -->
`conduit` is hosted on [NPM](https://www.npmjs.com/package/conduit-ws). It can be installed with either `npm` or `bun`, but it **needs [Bun](https://bun.sh/) to run**.

```
bun i -g conduit-ws
```

To host a server with automatic HTTPS, you'll also need to install [Caddy](https://caddyserver.com/).

## Usage

You can expose a port from your local machine using `conduit client` OR just by running `conduit`. __All of these options can be used on the base `conduit` command.__

```fish
Expose a local port through the conduit server

Usage: conduit client [options] <PORT>

Options:
  -t, --to <SERVER>            The conduit server to expose the local port on (default: conduit.ws)
  -p, --remotePort <PORT>      The remote port to request on the conduit server (default: 0)
  -d, --subdomain <SUBDOMAIN>  The subdomain to request from the server
  -k, --keepAlive              Keeps this connection alive indefinitely (default: false)
  -s, --secret <SECRET>        Secret key for authentication (optional) (default: environment variable CONDUIT_SECRET)
  -v, --verbose                Enable verbose output
  -h, --help                   Display help for command
```

### Running a `conduit` server

Self-hosting `conduit` is just as easy. You can start a server on port `4225` just by running `conduit server`, or you can configure it more:

```fish
Start a remote conduit server

Usage: conduit server [options]

Options:
  -d, --domain <DOMAIN>            The domain to use for web traffic tunneling (required for HTTPS)
  -b, --bind <BIND_ADDR>           The address to bind the server to (default: 0.0.0.0)
  -t, --tunnelBind <BIND_TUNNELS>  The address to bind tunnels to (default: 0.0.0.0)
  -m, --minPort <MIN_PORT>         The minimum port of the port range on which you want to allow incoming conections (default: 1024)
  -M, --maxPort <MAX_PORT>         The maximum port of the port range on which you want to allow incoming connections (default: 65535)
  -s, --secret <SECRET>            Secret key for authentication (optional) (default: environment variable CONDUIT_SECRET)
  -h, --help                       Display help for command
```

If you want to automatically add HTTPS to web traffic, you'll need to [install Caddy](https://github.com/caddyserver/caddy#install) and get it up and running. If you're on a Linux system it should come with a Systemd service (that you can start with `# systemctl start caddy`), or you can just run it yourself with `# caddy run`.

You'll also need to add a DNS record to point `*.yourdomain.com` at your server.

## How does it work?

`conduit` serves as a gateway between the public internet and local applications running on your machine, making it easy to showcase your work or spin up a webhook without the overhead of running your own server.
![`conduit` networking diagram](https://raw.githubusercontent.com/scherepi/conduit/main/.github/protocol-diagram.png)

`conduit` opens a control port on `4225`, where clients connect to open a tunnel. On connection, the client sends a request to reserve a specific port or subdomain (or port 0 to represent a random port if none was specified). The server responds with a message signifying success or failure, which is relayed back to the user. Once an unused port is found, the server starts listening for connections on that port.

When the server receives a connection on that port, it identifies the corresponding client and sends it a `NEW_CONNECTION` packet along with a randomly-generated 32-bit 'connection ID.' The client then opens a new connection with the local machine port, and from then on the client and the server proxy any information back and forth between the local server and the outside connection.

If the user requests a subdomain, after confirming the subdomain is not in use, the server will *still* forward the connection to a random port, but then it contacts [Caddy](https://caddyserver.com/) using the JSON API. `conduit` will reconfigure Caddy on the fly to add a new reverse proxy, forwarding any new connections on the subdomain to the port, which in turn forwards them to the client and then to the local application.

**Here's an example:**

Let's say my friend [Gus](https://github.com/gusruben) has written a really cool website in Svelte and wants to show me, but all his servers are busy hosting his awesome projects. Thankfully, there's a public `conduit` server running at [conduit.ws](https://conduit.ws) that we can use. His Svelte site is running on port **5173** on his local machine, and he'd like to have a subdomain with his name, so he uses the following command to connect to `conduit`:

`conduit -l 5173 -d gus`

Now, I can go to _gus.conduit.ws_, and the `conduit` server will pass along my web requests to Gus's site so that I get to see his web dev wizardry. **It's that easy.**

Or, if he used the command `conduit 5173 -p 1337` instead, I could go to _conduit.ws:1337_ for the same result.


# Acknowledgments

`conduit` was built in one night by myself, [Gus](https://github.com/gusruben), and [Sebastian](https://github.com/XDagging), the same team that brought you [You Throw Me](https://github.com/gusruben/you-throw-me). I'd like to thank the Exmilitary mixtape and the new Swans album for getting me through the all-nighter we pulled.

Conduit relies on [Caddy](https://caddyserver.com/) for automatically managing HTTPS.

<br>

> *This project is dedicated to [Hack Club](https://hackclub.com).*

<img src="https://assets.hackclub.com/flag-standalone.png" alt="Hack Club Flag" height="64">

[npm-shield]: https://img.shields.io/npm/v/conduit-ws?style=flat-square&labelColor=000000&color=b2ff00
[last-updated-shield]: https://img.shields.io/npm/last-update/conduit-ws?style=flat-square&labelColor=000000&color=b2ff00
[npm-link]: https://www.npmjs.com/package/conduit-ws
