async function test() {
  const url = 'https://html.duckduckgo.com/html/?q=site:freudtools.com+%22DCB518ASTS06G%22';
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } });
  const text = await res.text();
  console.log('Status:', res.status);
  const regex = /<a class="result__url" href="([^"]+)">/g;
  let m;
  while(m = regex.exec(text)) {
    let href = m[1];
    if (href.startsWith("//duckduckgo.com/l/?uddg=")) {
        href = decodeURIComponent(href.split("uddg=")[1].split("&")[0]);
    }
    console.log(href);
  }
}
test();
