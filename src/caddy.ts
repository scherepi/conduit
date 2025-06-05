import ky from "ky";
import { caddyPort, hostname } from ".";

export async function initCaddy(certFile: string, keyFile: string) {
    // clear the caddy config and set up our own with a pre-existing certificate
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
                        tls_connection_policies: [{}],
                    },
                },
            },
            tls: {
                certificates: {
                    load_files: [
                        {
                            certificate: certFile,
                            key: keyFile,
                            tags: ["global_cert"]
                        }
                    ]
                },
                automation: {
                    policies: [
                        {
                            subjects: [hostname, "*." + hostname],
                            issuers: [{
                                module: "internal", // internal issuer is fallback
                            }],
                            // reuse_private_keys: true,
                        }
                    ]
                }
            }
        },
    };

    try {
        const response = await ky.post(`http://localhost:${caddyPort}/config/`, {
            json: baseConfig,
        });
        
        console.log(`Initialized Caddy configuration with pre-existing certificate.`);
        return response.json();
    } catch (error: any) {
        console.error("Failed to initialize Caddy:", error.message);
        if (error.response) {
            const errorText = await error.response.text();
            console.error("Error details:", errorText);
        }
        throw error;
    }
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
        await ky.put(`http://localhost:${caddyPort}/config/apps/http/servers/conduit/routes/0`, {
            json: config,
        });
        console.log("Added reverse proxy for", subdomain, "on port", port);
    } catch (e: any) {
        console.error(`Failed to add reverse proxy for ${subdomain}:\n`, e);
        console.log(await e.response.text())
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