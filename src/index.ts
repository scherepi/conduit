// Main CLI logic, started by Joaquin 6/5/2025
import { Command } from 'commander';
import { connectToConduit } from './client';
import { startServer } from "./server";
import logger from './logger';
const program = new Command();

program
	.name('conduit')
	.description('Conduit - a link between worlds.')
	.version('1.0.0');

program
	// conduit remotehost -l localPort -p remotePort -d subdomain -v verbosityLevel 
	.argument('<remotehost>', 'the remote host to try to tunnel to')
	.requiredOption('-l, --localPort <portNumber>', 'the local port to try to tunnel to the server', )
	.option('-p, --remotePort <portNumber>', 'the remote port to request from the server (optional)')
	.option('-d, --subdomain <subdomain>', 'the subdomain to request from the server. -p and -d are mutually exclusive.')
	.option('-v, --verbose', 'enable verbose output', false)
	.action((remoteHost, options, _command) => {
		logger.verbose = options.verbose;

		if (options.remotePort && options.subdomain) {
			console.error("You can't pick both, doofus!");
			console.log("Rerun the command with EITHER the subdomain argument or the remote port.");
		}
		if (options.remotePort) {
			connectToConduit(remoteHost, options.localPort, options.remotePort);
		}
		if (options.subdomain) {
			connectToConduit(remoteHost, options.localPort, null, options.subdomain);
		}
	})

// conduit server <bindAddress> -t tunnelAddress -m minimumPort -M maximumPort 
program.command('server')
	.description('Base functionality.')
	.option('-b, --bind', 'the address to bind the server to', '0.0.0.0')
	.option('-t, --tunnelBind', 'the address to bind tunnels to.', '0.0.0.0')
	.option('-m, --minPort', 'the minimum port of the port range on which you want to allow incoming conections', '1024')
	.option('-M, --maxPort', 'the maximum port of the port range on which you want to allow incoming connections', '65535')
	.action((bindAddress, options, command) => {
		if (options.minPort && isNaN(parseInt(options.minPort))) {
			console.error("Minimum port needs to be valid integer.")
		}
		if (options.maxPort && isNaN(parseInt(options.maxPort))) {
			console.error("Maximum port needs to be valid integer.");
		}
		startServer(bindAddress, options.tunnelBind, parseInt(options.minPort), parseInt(options.maxPort));
	})


program.parse();