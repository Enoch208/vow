import { createSupplierServer } from './supplier/server.ts';
const server = createSupplierServer();
server.on('error', () => { process.stderr.write('Could not start the isolated supplier tool on port 4318.\n'); process.exitCode = 1; });
server.listen(4318, '127.0.0.1', () => process.stdout.write('Local supplier key tool: http://127.0.0.1:4318\n'));
