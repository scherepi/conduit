// Main CLI logic, started by Joaquin 6/5/2025
import { Command } from "commander";
import { connectToConduit } from "./client";
import { startServer } from "./server";
import logger from "./logger";
const program = new Command();

let server = Bun.argv[2] == "server" ? true : false;

program
	.name("conduit")
	.description("Conduit - a link between worlds.")
	.version("1.0.0", "-V, --version", "Output the version number and exit")
	.helpOption("-h, --help", "Display help for command");

if (!server) {
	program
		// conduit remotehost -l localPort -p remotePort -d subdomain -v verbosityLevel
		.argument("<remotehost>", "The remote host to try to tunnel to")
		.requiredOption("-l, --localPort <portNumber>", "The local port to expose")
		.option(
			"-p, --remotePort <number>",
			"The remote port to request on the conduit server (optional)"
		)
		.option(
			"-d, --subdomain <string>",
			"The subdomain to request from the server. -p and -d are mutually exclusive."
		)
		.option("-v, --verbose", "Enable verbose output", false)
		.action((remoteHost, options, _command) => {
			logger.verbose = options.verbose;

			if (options.remotePort && options.subdomain) {
				logger.error("You can't pick both, doofus!");
				logger.error("Rerun the command with EITHER the subdomain argument or the remote port.");
			}
			if (options.remotePort) {
				connectToConduit(remoteHost, parseInt(options.localPort), parseInt(options.remotePort));
			}
			if (options.subdomain) {
				connectToConduit(remoteHost, parseInt(options.localPort), null, options.subdomain);
			}
		});
}

// conduit server <bindAddress> -t tunnelAddress -m minimumPort -M maximumPort
program
	.command("server")
	.option("-d, --domain [domainName]", "the domain to use for the server")
	.option("-b, --bind", "the address to bind the server to", "0.0.0.0")
	.option("-t, --tunnelBind", "the address to bind tunnels to.", "0.0.0.0")
	.option(
		"-m, --minPort",
		"the minimum port of the port range on which you want to allow incoming conections",
		"1024"
	)
	.option(
		"-M, --maxPort",
		"the maximum port of the port range on which you want to allow incoming connections",
		"65535"
	)
	.action((options, command) => {
		if (options.minPort && isNaN(parseInt(options.minPort))) {
			logger.error("Minimum port needs to be valid integer.");
		}
		if (options.maxPort && isNaN(parseInt(options.maxPort))) {
			logger.error("Maximum port needs to be valid integer.");
		}
		startServer(
			options.bind,
			options.tunnelBind,
			parseInt(options.minPort),
			parseInt(options.maxPort)
		);
	});

if (process.argv.length <= 2) {
	program.help();
} else {
	program.parse();
}
