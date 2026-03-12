const { io, server } = require('..');
const http = require('http');
const ioClient = require('socket.io-client');
const packageJson = require('../package.json');

describe('socket server', () => {
  let port;

  function request(pathname) {
    return new Promise((resolve, reject) => {
      const req = http.get({
        host: '127.0.0.1',
        port,
        path: pathname,
      }, res => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', chunk => {
          body += chunk;
        });
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body,
          });
        });
      });

      req.on('error', reject);
    });
  }

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

  test('exposes health and version info over http', async () => {
    const health = await request('/health');
    const version = await request('/version');
    const home = await request('/');

    expect(health.statusCode).toBe(200);
    expect(JSON.parse(health.body)).toEqual({
      status: 'ok',
      version: packageJson.version,
      build: null,
    });

    expect(version.statusCode).toBe(200);
    expect(JSON.parse(version.body)).toEqual({
      version: packageJson.version,
      build: null,
      label: packageJson.version,
    });

    expect(home.statusCode).toBe(200);
    expect(home.body).toContain(`v ${packageJson.version}`);
    expect(home.body).not.toContain('__APP_VERSION__');
  });

  test('returns saved note in join callback for reconnecting clients', done => {
    const client1 = ioClient(`http://localhost:${port}`);
    const client2 = ioClient(`http://localhost:${port}`);

    const roomId = `room-${Date.now()}`;
    const note = 'ABC-123 current task';

    client1.on('connect', () => {
      client1.emit('join', { roomId, name: 'Admin', isAdmin: true });
      setTimeout(() => {
        client1.emit('note_update', { roomId, note });
        setTimeout(() => {
          client2.emit('join', { roomId, name: 'User' }, state => {
            try {
              expect(state).toEqual(expect.objectContaining({
                note,
                revealed: false,
                estimationMode: 'points',
              }));
              expect(Array.isArray(state.players)).toBe(true);
              expect(state.players).toHaveLength(2);
              done();
            } finally {
              client1.close();
              client2.close();
            }
          });
        }, 50);
      }, 50);
    });
  });

  test('syncs task list state and selected task across clients', done => {
    const adminClient = ioClient(`http://localhost:${port}`);
    const viewerClient = ioClient(`http://localhost:${port}`);

    const roomId = `tasks-${Date.now()}`;
    const items = [
      'https://tracker.example/ABC-123',
      'https://tracker.example/ABC-124',
    ];

    viewerClient.on('task_state_update', state => {
      try {
        expect(state).toEqual({
          items,
          selectedIndex: 1,
        });
        done();
      } finally {
        adminClient.close();
        viewerClient.close();
      }
    });

    adminClient.on('connect', () => {
      adminClient.emit('join', { roomId, name: 'Admin', isAdmin: true }, () => {
        adminClient.emit('task_list_update', { roomId, items }, updateResult => {
          expect(updateResult).toEqual({
            ok: true,
            taskState: {
              items,
              selectedIndex: 0,
            },
            estimationMode: 'points',
          });

          viewerClient.emit('join', { roomId, name: 'Viewer' }, state => {
            expect(state.taskState).toEqual({
              items,
              selectedIndex: 0,
            });
            expect(state.estimationMode).toBe('points');

            adminClient.emit('task_select', { roomId, direction: 1 }, selectResult => {
              expect(selectResult).toEqual({
                ok: true,
                taskState: {
                  items,
                  selectedIndex: 1,
                },
                estimationMode: 'points',
              });
            });
          });
        });
      });
    });
  });

  test('syncs estimation mode and resets it to points on task switch', done => {
    const adminClient = ioClient(`http://localhost:${port}`);
    const viewerClient = ioClient(`http://localhost:${port}`);

    const roomId = `mode-${Date.now()}`;
    const items = [
      'https://tracker.example/ABC-123',
      'https://tracker.example/ABC-124',
    ];

    adminClient.on('connect', () => {
      adminClient.emit('join', { roomId, name: 'Admin', isAdmin: true }, () => {
        viewerClient.emit('join', { roomId, name: 'Viewer' }, state => {
          expect(state.estimationMode).toBe('points');

          adminClient.emit('task_list_update', { roomId, items }, () => {
            const handleHoursMode = mode => {
              if (mode !== 'hours') {
                return;
              }
              viewerClient.off('estimation_mode_update', handleHoursMode);

              try {
                let gotTaskState = false;
                let gotResetMode = false;
                const finish = () => {
                  if (!gotTaskState || !gotResetMode) return;
                  adminClient.close();
                  viewerClient.close();
                  done();
                };

                viewerClient.once('task_state_update', taskState => {
                  expect(taskState).toEqual({
                    items,
                    selectedIndex: 1,
                  });
                  gotTaskState = true;
                  finish();
                });

                viewerClient.once('estimation_mode_update', resetMode => {
                  expect(resetMode).toBe('points');
                  gotResetMode = true;
                  finish();
                });

                adminClient.emit('task_select', { roomId, direction: 1 }, selectResult => {
                  expect(selectResult).toEqual({
                    ok: true,
                    taskState: {
                      items,
                      selectedIndex: 1,
                    },
                    estimationMode: 'points',
                  });
                });
              } catch (error) {
                adminClient.close();
                viewerClient.close();
                done(error);
              }
            };
            viewerClient.on('estimation_mode_update', handleHoursMode);

            adminClient.emit('set_estimation_mode', { roomId, mode: 'hours' }, result => {
              expect(result).toEqual({
                ok: true,
                estimationMode: 'hours',
              });
            });
          });
        });
      });
    });
  });
});
