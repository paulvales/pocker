Windows-oriented commands for this repo:
- `npm install` to install dependencies
- `npm start` to run the server locally
- `npm test` to run Jest suites
- `node ./scripts/stress-vote.js` or `npm run stress:votes` for vote/reconnect stress testing
- `docker compose -f docker-compose.dev.yml up -d --build` for local Docker dev
- `docker compose -f docker-compose.dev.yml down` to stop local Docker dev
- `scripts\docker-local-rebuild.bat` as Windows helper for local Docker rebuilds
- `git diff -- <path>` to inspect changes
- `Get-Content <file>` / `Select-String` / `Get-ChildItem` are the basic Windows shell inspection commands in this environment.