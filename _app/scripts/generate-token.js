import jwt from 'jsonwebtoken';

const payload = {
  id: 1,
  username: 'admin',
  role: 'Admin'
};

const secret = 'stratanote-collaborative-secret-key-2026';

// 10 years expiration
const token = jwt.sign(payload, secret, { expiresIn: '3650d' });
console.log('New Token:');
console.log(token);

try {
  const decoded = jwt.verify(token, secret);
  console.log('Verification Success:');
  console.log(decoded);
} catch (err) {
  console.log('Verification Failed:', err.message);
}
