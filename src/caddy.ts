import ky from "ky";
import { caddyPort, hostname } from ".";

export async function initCaddy() {
    // clear the caddy config and set up our own
    const baseConfig = {
        apps: {
            http: {
                servers: {
                    conduit: {
                        listen: [":80", ":443"],
                        routes: [
                            {
                                match: [{ host: [hostname] }],
                                handle: [
                                    {
                                        handler: "static_response",
                                        headers: {
                                            Location: ["https://github.com/scherepi/conduit"],
                                        },
                                        status_code: 302,
                                    },
                                ],
                            },
                        ],
                    },
                },
            },
        },
    };

    const response = await ky.post(`http://localhost:${caddyPort}/config/`, {
        json: baseConfig,
    });

    console.log(`Initialized Caddy confguration.`);
    return response.json();
}

export async function addReverseProxy(subdomain: string, port: number) {
    const config = {
        match: [{ host: [`${subdomain}.${hostname}`] }],
        handle: [{
            handler: "reverse_proxy",
            upstreams: [{ dial: `localhost:${port}` }],
        }]
    };

    try {
        await ky.patch(`http://localhost:${caddyPort}/config/apps/http/servers/conduit/routes`, {
            json: config,
        });
        console.log("Added reverse proxy for", subdomain, "on port", port);
    } catch (e) {
        console.error(`Failed to add reverse proxy for ${subdomain}:\n`, e);
    }
}

export async function removeReverseProxy(subdomain: string) {
    try {
        const currentConfig: any[] = await ky.get(`http://localhost:${caddyPort}/config/apps/http/servers/conduit/routes`).json();

        // find the index of the route for the subdomain
        const routeIndex = currentConfig.findIndex(route =>
            Array.isArray(route.match) &&
            route.match.some((m: any) =>
                Array.isArray(m.host) && m.host.includes(`${subdomain}.${hostname}`)
            )
        );

        if (routeIndex === -1) {
            console.warn(`No reverse proxy found for ${subdomain}`);
            return;
        }

        // remove that specific route (by index)
        await ky.delete(
            `http://localhost:${caddyPort}/config/apps/http/servers/conduit/routes/${routeIndex}`
        );
        console.log(`Removed reverse proxy for ${subdomain}`);
    } catch (e) {
        console.error(`Failed to remove reverse proxy for ${subdomain}:\n`, e);
    }
}