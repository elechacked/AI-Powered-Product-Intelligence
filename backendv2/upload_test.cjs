const fs = require('fs');

const testCsv = `Mfg_Part_Num,Part_Desc
DCB518ASTS06G,1/2 x 18 Detail File Sanding Belt Assorted Pack 6-pc`;

fs.writeFileSync('test_upload.csv', testCsv);

fetch('http://localhost:8000/api/upload', {
  method: 'POST',
  body: (() => {
    const fd = new FormData();
    fd.append('file', new Blob([testCsv], { type: 'text/csv' }), 'test_upload.csv');
    return fd;
  })()
})
.then(res => res.json())
.then(data => console.log("Upload result:", data))
.catch(err => console.error(err));
