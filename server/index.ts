import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import * as agent from './agent.js';
import * as pty from './pty.js';
import { attachmentRoutes } from './routes/attachments.js';
import { branchRoutes } from './routes/branches.js';
import { chatRoutes } from './routes/chats.js';
import { commitMessageRoutes } from './routes/commitMessage.js';
import { gitRoutes } from './routes/git.js';
import { identityRoutes } from './routes/identity.js';
import { projectRoutes } from './routes/projects.js';
import { remoteRoutes } from './routes/remote.js';
import { sessionRoutes } from './routes/sessions.js';
import { settingsRoutes } from './routes/settings.js';
import { storageRoutes } from './routes/storage.js';
import { terminalRoutes } from './routes/terminal.js';
import { userRoutes } from './routes/user.js';

const PORT = Number(process.env.PORT ?? 5174);
const isProduction = process.env.NODE_ENV === 'production';

const app = Fastify({
  logger: { level: isProduction ? 'warn' : 'info', transport: undefined },
  // Diffs and tool results can be large; the default 1MB body cap is too tight.
  bodyLimit: 8 * 1024 * 1024
});

// Terminals are websockets; everything else is plain HTTP.
await app.register(websocket);

await app.register(projectRoutes);
await app.register(chatRoutes);
await app.register(gitRoutes);
await app.register(remoteRoutes);
await app.register(identityRoutes);
await app.register(branchRoutes);
await app.register(sessionRoutes);
await app.register(userRoutes);
await app.register(commitMessageRoutes);
await app.register(attachmentRoutes);
await app.register(settingsRoutes);
await app.register(storageRoutes);
await app.register(terminalRoutes);

// In development Vite serves the client and proxies here. In production Fastify serves
// the built assets too, so running Flight Deck is one command and one origin.
if (isProduction) {
  const { default: fastifyStatic } = await import('@fastify/static');
  const root = fileURLToPath(new URL('../dist', import.meta.url));
  await app.register(fastifyStatic, { root });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api')) {
      reply.status(404).send({ error: { message: `No such route: ${req.url}` } });
      return;
    }
    reply.sendFile('index.html');
  });
}

// An agent left running after the server dies keeps editing a repo with nobody watching.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void (async () => {
      // A shell outliving the app would keep running against a repo with nobody attached.
      pty.disposeAll();
      await agent.shutdown();
      await app.close();
      process.exit(0);
    })();
  });
}

await app.listen({ port: PORT, host: '127.0.0.1' });
