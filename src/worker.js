export default {
    async fetch(request) {
        const url = new URL(request.url);

        if (url.pathname === '/health') {
            return new Response('OK', { status: 200 });
        }

        if (url.pathname === '/ws' && request.headers.get('Upgrade') === 'websocket') {
            const pair = new WebSocketPair();
            const [client, server] = Object.values(pair);

            server.accept();
            server.addEventListener('message', (evt) => server.send('echo: ' + evt.data));

            return new Response(null, { status: 101, webSocket: client });
        }

        return new Response('Not found', { status: 404 });
    }
}
