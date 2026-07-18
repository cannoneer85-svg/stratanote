import jwt from 'jsonwebtoken';

const token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MSwidXNlcm5hbWUiOiJhZG1pbiIsInJvbGUiOiJBZG1pbiIsImlhdCI6MTc4MzEyMjM1OCwiZXhwIjoxODE0NjU4MzU4fQ.07wYPZPQDjpb_A8k7OnA2EmFYl9x3dkJpO1xbJ0cO18';

const secrets = [
  'stratanote-collaborative-secret-key-2026',
  'obsidian-collaborative-secret-key-2026'
];

for (const secret of secrets) {
  try {
    const decoded = jwt.verify(token, secret);
    console.log(`Success with secret: "${secret}"`);
    console.log(decoded);
  } catch (err) {
    console.log(`Failed with secret: "${secret}" - ${err.message}`);
  }
}
