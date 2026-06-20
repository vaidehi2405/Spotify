import * as store from 'app-store-scraper';

async function test() {
  console.log("Testing multiple pages for country 'us' and 'gb'...");
  for (const page of [1, 2, 3, 4, 5]) {
    try {
      const reviews = await (store as any).reviews({
        id: 324684580,
        country: 'us',
        sort: (store as any).sort.RECENT,
        page
      });
      console.log(`US Page ${page} -> Fetched ${reviews ? reviews.length : 0} reviews`);
    } catch (err: any) {
      console.error(`US Page ${page} -> Failed: ${err.message}`);
    }
  }

  for (const page of [1, 2, 3, 4, 5]) {
    try {
      const reviews = await (store as any).reviews({
        id: 324684580,
        country: 'gb',
        sort: (store as any).sort.RECENT,
        page
      });
      console.log(`GB Page ${page} -> Fetched ${reviews ? reviews.length : 0} reviews`);
    } catch (err: any) {
      console.error(`GB Page ${page} -> Failed: ${err.message}`);
    }
  }
}

test().catch(console.error);
