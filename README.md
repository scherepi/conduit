<div align="center">

<img height="300" src="https://raw.githubusercontent.com/scherepi/conduit/main/.github/header.png">

</div>

[![][npm-shield]][npm-link]

<!-- for a divider line -->
<h1 align="center"></h1>


Conduit is a smart utility for sharing local apps with the world, no server deployment or firewall wrangling necessary. It tunnels your local ports through NAT and firewalls, automatically adds HTTPS to your endpoints, and lets you show off your projects or test webhooks in seconds. Just run `conduit` and your machine is open for business (the fun kind).

**Try it out:**

```
npx conduit-ws 3000
```

<a href="https://asciinema.org/a/722341" target="_blank"><img src="https://asciinema.org/a/722341.svg" /></a>

This will publicly expose `localhost:3000` on a random port on `conduit.ws`. Want a subdomain with HTTPS?

```
npx conduit-ws 3000 -d foobar
```

This will connect your website directly to **https**://foobar.conduit.ws.

## Demo

<!-- asciinema -->

## Installation

<!-- is bun a requirement? mention here -->
Conduit is hosted on [NPM](https://www.npmjs.com/package/conduit-ws).

```
npm i -g conduit-ws
```

## Usage

You can expose a port from your local machine using `conduit client` OR just by running `conduit`. __All of these options can be used on the base `conduit` command.__

```
Expose a local port through the conduit server

Usage: conduit client [options] <PORT>

Options:
  -t, --to <SERVER>            The conduit server to expose the local port on (default: conduit.ws)
  -p, --remotePort <PORT>      The remote port to request on the conduit server (default: 0)
  -d, --subdomain <SUBDOMAIN>  The subdomain to request from the server
  -k, --keepAlive              Keeps this connection alive indefinitely (default: false)
  -v, --verbose                Enable verbose output
  -h, --help                   Display help for command
```

### Running a Conduit server

Self-hosting `conduit` is just as easy. You can start a server on port `4225` just by running `conduit server`, or you can configure it more:

```
Usage: conduit server [options]

Options:
  -d, --domain <DOMAIN>            The domain to use for web traffic tunneling (required for HTTPS)
  -b, --bind <BIND_ADDR>           the address to bind the server to (default: 0.0.0.0)
  -t, --tunnelBind <BIND_TUNNELS>  the address to bind tunnels to (default: 0.0.0.0)
  -m, --minPort <MIN_PORT>         the minimum port of the port range on which you want to allow incoming conections (default: 1024)
  -M, --maxPort <MAX_PORT>         the maximum port of the port range on which you want to allow incoming connections (default: 65535)
  -h, --help                       Display help for command
```

## How does it work?

Conduit serves as a gateway between external observers and local applications running on your machine, allowing you to showcase your work without the overhead of running your own server.
![Conduit networking diagram](https://hc-cdn.hel1.your-objectstorage.com/s/v3/ad975562c6adc800c4865dfb922f41707737c870_conduit_diagram__1_.png)
When your client connects to the server, you can request either a specific port on the server **or** a subdomain, and specify the local port you'd like to mirror. The server reserves that port/subdomain for you if available, and listens on that port for requests from external observers who'd like to connect to your machine.

When the server gets a request to the port or subdomain you reserved, it uses our special messaging logic to give that communication a unique identifier, and reports the new connection to your client. The client then creates a localized tunnel to the port on your machine where your local application is running, and the data interchange begins, with the server and client working together to pass data between your local application and the external observer.

**Here's an example:**

Let's say my friend [Gus](https://github.com/gusruben) has written a really cool website in Svelte and wants to show me, but all his servers are busy hosting his awesome projects. Thankfully, I have a Conduit server running at [conduit.ws](https://conduit.ws) that we can use. His Svelte site is running on port **5173** on his local machine, and he'd like to have a subdomain with his name, so he uses the following command to connect to Conduit:

`bun run src conduit.ws -l 5173 -d gus`

Now, I can go to _gus.conduit.ws_, and the Conduit server will pass along my web requests to Gus's site so that I get to see his web dev wizardry. **It's that easy.**

Or, if he used the command `bun run src conduit.ws -l 5173 -p 8070` instead, I could go to _conduit.ws:8070_ for the same result.


# Acknowledgments

Conduit was built in one night by myself, [Gus](https://github.com/gusruben), and [Sebastian](https://github.com/XDagging), the same team that brought you [You Throw Me](https://github.com/gusruben/you-throw-me). I'd like to thank the Exmilitary mixtape and the new Swans album for getting me through the all-nighter we pulled. Thank you to the [Caddy](https://github.com/caddyserver/caddy) project for making the reverse proxy element simple, and to [Hack Club](https://hackclub.com) for creating an incredible environment for innovation and creativity - we hope Conduit helps make development more accessible for all of you.


[npm-shield]: https://img.shields.io/npm/v/conduit-ws?style=flat-square&color=%23b2ff00
[npm-link]: https://www.npmjs.com/package/conduit-ws
