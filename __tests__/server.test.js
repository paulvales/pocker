const { io, server } = require('..');
const ioClient = require('socket.io-client');

describe('socket server', () => {
  let port;

  beforeAll(done => {
    server.listen(() => {
      port = server.address().port;
      done();
    });
  });

  afterAll(done => {
    io.close();
    server.close(done);
  });

  test('broadcasts note updates to other clients', done => {
    const client1 = ioClient(`http://localhost:${port}`);
    const client2 = ioClient(`http://localhost:${port}`);

    const roomId = 'room1';
    const note = 'hello';

    client2.on('note_update', msg => {
      try {
        expect(msg).toBe(note);
        done();
      } finally {
        client1.close();
        client2.close();
      }
    });

    client1.on('connect', () => {
      client1.emit('join', { roomId, name: 'A' });
      client2.emit('join', { roomId, name: 'B' });
      setTimeout(() => {
        client1.emit('note_update', { roomId, note });
      }, 50);
    });
  });
});
