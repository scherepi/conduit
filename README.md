<div align="center">

<img height="300" src="https://raw.githubusercontent.com/scherepi/conduit/main/.github/header.png">

<!-- for a divider line -->
<h1 align="center"></h1>

[![][npm-shield]][npm-link]


</div>

Conduit is a tool that makes tunneling quick and easy, with support for custom subdomains thanks to Caddy.

```
npx conduit-ws 3000
```

## How does it work?

Conduit serves as a gateway between external observers and local applications running on your machine, allowing you to showcase your work without the overhead of running your own server.
![Conduit diagram](https://hc-cdn.hel1.your-objectstorage.com/s/v3/ad975562c6adc800c4865dfb922f41707737c870_conduit_diagram__1_.png)
When your client connects to the server, you can request either a specific port on the server **or** a subdomain, and specify the local port you'd like to mirror. The server reserves that port/subdomain for you if available, and listens on that port for requests from external observers who'd like to connect to your machine.

When the server gets a request to the port or subdomain you reserved, it uses our special messaging logic to give that communication a unique identifier, and reports the new connection to your client. The client then creates a localized tunnel to the port on your machine where your local application is running, and the data interchange begins, with the server and client working together to pass data between your local application and the external observer.

**Here's an example:**

Let's say my friend [Gus](https://github.com/gusruben) has written a really cool website in Svelte and wants to show me, but all his servers are busy hosting his awesome projects. Thankfully, I have a Conduit server running at [conduit.ws](https://conduit.ws) that we can use. His Svelte site is running on port **5173** on his local machine, and he'd like to have a subdomain with his name, so he uses the following command to connect to Conduit:

`bun run src conduit.ws -l 5173 -d gus`

Now, I can go to _gus.conduit.ws_, and the Conduit server will pass along my web requests to Gus's site so that I get to see his web dev wizardry. **It's that easy.**

Or, if he used the command `bun run src conduit.ws -l 5173 -p 8070` instead, I could go to _conduit.ws:8070_ for the same result.

## Running a Conduit server

You can run your very own Conduit server just as easily using the Conduit CLI. You can specify the bind address, tunnel address, and allowed port range separately using the command flags, or you can simply run:

`bun run src server`

...and you'll have your Conduit server running on **port 4225** right out of the box. Once again, it's **that easy.**

# Acknowledgments

Conduit was built in one night by myself, [Gus](https://github.com/gusruben), and [Sebastian](https://github.com/XDagging), the same team that brought you [You Throw Me](https://github.com/gusruben/you-throw-me). I'd like to thank the Exmilitary mixtape and the new Swans album for getting me through the all-nighter we pulled. Thank you to the [Caddy](https://github.com/caddyserver/caddy) project for making the reverse proxy element simple, and to [Hack Club](https://hackclub.com) for creating an incredible environment for innovation and creativity - we hope Conduit helps make development more accessible for all of you.


[npm-shield]: https://img.shields.io/npm/v/conduit-ws?style=flat-square&labelColor=%23232529&color=%233995FF
[npm-link]: https://www.npmjs.com/package/conduit-ws
