import googleIt from 'google-it';

async function test() {
  try {
    const results = await googleIt({ query: 'Freud Inc official website', disableConsole: true });
    console.log(results.map(r => r.link));
  } catch (e) {
    console.error(e);
  }
}
test();
