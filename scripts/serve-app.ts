import { createAppServer } from './app/server.ts';

const server = createAppServer();
server.on('error', () => {
  process.stderr.write('Could not start the local VOW product screens on port 4319.\n');
  process.exitCode = 1;
});
server.listen(4319, '127.0.0.1', () => process.stdout.write('VOW product screens: http://127.0.0.1:4319\n'));
