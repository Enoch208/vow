import { createDiagnosticServer } from './diagnostic/server.ts';

const server = createDiagnosticServer();
server.on('error', () => {
  process.stderr.write('Could not start the local wallet diagnostic on port 4317.\n');
  process.exitCode = 1;
});
server.listen(4317, '127.0.0.1', () => process.stdout.write('VOW read-only wallet diagnostic: http://127.0.0.1:4317\n'));
