import { writeFileSync, existsSync, rmSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const assetsDir = resolve(__dirname, '..', '..', 'assets');

const BASE_URL = `http://localhost:${process.env.PORT || 3001}`;

async function runTests() {
  console.log('=== Starting Media Support Integration Tests ===');

  try {
    // Pre-cleanup to ensure clean state
    const pre1 = join(assetsDir, 'test-image.png');
    const pre2 = join(assetsDir, 'test-image (1).png');
    const pre3 = join(assetsDir, 'test-image (2).png');
    if (existsSync(pre1)) rmSync(pre1);
    if (existsSync(pre2)) rmSync(pre2);
    if (existsSync(pre3)) rmSync(pre3);

    // 1. Authenticate admin user
    console.log('1. Authenticating as admin...');
    const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin' })
    });

    if (!loginRes.ok) {
      throw new Error(`Authentication failed: ${loginRes.status} ${loginRes.statusText}`);
    }

    const { token } = await loginRes.json();
    console.log('✓ Authenticated successfully. Token obtained.');

    // 2. Upload a test image
    console.log('\n2. Uploading test image...');
    const testBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='; // 1x1 png
    const upload1Res = await fetch(`${BASE_URL}/api/notes/upload-media`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ filename: 'test-image.png', base64Data: testBase64 })
    });

    if (!upload1Res.ok) {
      throw new Error(`Upload 1 failed: ${upload1Res.status} ${await upload1Res.text()}`);
    }

    const data1 = await upload1Res.json();
    console.log(`✓ Upload 1 success. URL: ${data1.url}, Filename: ${data1.filename}`);
    if (data1.filename !== 'test-image.png') {
      throw new Error(`Expected filename to be test-image.png, got ${data1.filename}`);
    }

    // 3. Upload same test image again to test conflict-resolution renaming
    console.log('\n3. Uploading duplicate test image (conflict check)...');
    const upload2Res = await fetch(`${BASE_URL}/api/notes/upload-media`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ filename: 'test-image.png', base64Data: testBase64 })
    });

    if (!upload2Res.ok) {
      throw new Error(`Upload 2 failed: ${upload2Res.status}`);
    }

    const data2 = await upload2Res.json();
    console.log(`✓ Upload 2 success. URL: ${data2.url}, Filename: ${data2.filename}`);
    if (data2.filename !== 'test-image (1).png') {
      throw new Error(`Expected conflict resolution to rename to test-image (1).png, got ${data2.filename}`);
    }

    // 4. Download file via raw authenticated route
    console.log('\n4. Fetching uploaded file via raw secure route...');
    const fetchRes = await fetch(`${BASE_URL}/api/raw/${data1.url}?token=${token}`);
    if (!fetchRes.ok) {
      throw new Error(`Failed to fetch raw file: ${fetchRes.status}`);
    }
    const arrayBuffer = await fetchRes.arrayBuffer();
    const fetchedBuffer = Buffer.from(arrayBuffer);
    const originalBuffer = Buffer.from(testBase64, 'base64');
    
    if (Buffer.compare(fetchedBuffer, originalBuffer) !== 0) {
      throw new Error('Downloaded file content does not match original file content!');
    }
    console.log('✓ Raw secure file retrieved and verified successfully.');

    // 5. Test access without token (should be rejected)
    console.log('\n5. Testing access to raw file without token...');
    const noTokenRes = await fetch(`${BASE_URL}/api/raw/${data1.url}`);
    console.log(`Response status: ${noTokenRes.status}`);
    if (noTokenRes.status !== 401) {
      throw new Error(`Expected 401 Unauthorized, got ${noTokenRes.status}`);
    }
    console.log('✓ Access without token successfully rejected.');

    // 6. Test path traversal protection (should be rejected)
    console.log('\n6. Testing path traversal protection...');
    const traversalRes = await fetch(`${BASE_URL}/api/raw/assets%2F..%2F..%2F..%2F..%2Fwindows%2Fwin.ini?token=${token}`);
    console.log(`Response status: ${traversalRes.status}`);
    if (traversalRes.status !== 403) {
      throw new Error(`Expected 403 Forbidden, got ${traversalRes.status}`);
    }
    console.log('✓ Path traversal request successfully rejected.');

    // 7. Test listing media files
    console.log('\n7. Testing GET /api/notes/media...');
    const listRes = await fetch(`${BASE_URL}/api/notes/media`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!listRes.ok) {
      throw new Error(`Failed to list media files: ${listRes.status}`);
    }
    const mediaList = await listRes.json();
    console.log(`✓ Media files listed: ${mediaList.length} files found.`);
    const hasImage1 = mediaList.some(f => f.filename === data1.filename);
    const hasImage2 = mediaList.some(f => f.filename === data2.filename);
    if (!hasImage1 || !hasImage2) {
      throw new Error('Listed media files did not contain the uploaded test files!');
    }
    console.log('✓ Uploaded test files found in media list.');

    // 8. Test deleting media files via API
    console.log('\n8. Deleting media files via DELETE /api/notes/media/:filename...');
    const delete1Res = await fetch(`${BASE_URL}/api/notes/media/${encodeURIComponent(data1.filename)}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!delete1Res.ok) {
      throw new Error(`Failed to delete file 1: ${delete1Res.status}`);
    }
    console.log(`✓ File 1 (${data1.filename}) deleted successfully via API.`);

    const delete2Res = await fetch(`${BASE_URL}/api/notes/media/${encodeURIComponent(data2.filename)}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!delete2Res.ok) {
      throw new Error(`Failed to delete file 2: ${delete2Res.status}`);
    }
    console.log(`✓ File 2 (${data2.filename}) deleted successfully via API.`);

    // 9. Test path traversal on DELETE (should be rejected)
    console.log('\n9. Testing path traversal protection on DELETE...');
    const traversalDeleteRes = await fetch(`${BASE_URL}/api/notes/media/..%2F..%2F..%2Fwin.ini`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    console.log(`Response status: ${traversalDeleteRes.status}`);
    if (traversalDeleteRes.status !== 403 && traversalDeleteRes.status !== 404) {
      throw new Error(`Expected 403 Forbidden or 404 Not Found, got ${traversalDeleteRes.status}`);
    }
    console.log('✓ Path traversal DELETE request successfully rejected (403 or 404).');

    // 10. Verify deletion from list
    console.log('\n10. Verifying deletion from GET /api/notes/media...');
    const listResAfter = await fetch(`${BASE_URL}/api/notes/media`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const mediaListAfter = await listResAfter.json();
    const hasImage1After = mediaListAfter.some(f => f.filename === data1.filename);
    const hasImage2After = mediaListAfter.some(f => f.filename === data2.filename);
    if (hasImage1After || hasImage2After) {
      throw new Error('Test files are still present in media list after deletion!');
    }
    console.log('✓ Verified: test files no longer in media list.');

    console.log('\n=== ALL TESTS PASSED SUCCESSFULLY ===');
  } catch (err) {
    console.error('\n❌ Test failed with error:', err);
    process.exit(1);
  }
}

runTests();
