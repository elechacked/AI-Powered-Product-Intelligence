import fs from 'fs';
async function run() {
  const csvContent = `"Mfg_Part_Num","Part_Desc"
"DCB518ASTS06G","DCB518ASTS06G Diablo 1/2\\"x18\\" - Sanding Belt 6pc"`;

  const boundary = '----WebKitFormBoundary7MA4YWxkTrZu0gW';
  const body = Buffer.concat([
    Buffer.from('--' + boundary + '\r\n'),
    Buffer.from('Content-Disposition: form-data; name="file"; filename="test.csv"\r\n'),
    Buffer.from('Content-Type: text/csv\r\n\r\n'),
    Buffer.from(csvContent),
    Buffer.from('\r\n--' + boundary + '--\r\n')
  ]);
  const response = await fetch('http://localhost:8000/api/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'multipart/form-data; boundary=' + boundary },
    body
  });
  console.log(await response.json());
}
run();
