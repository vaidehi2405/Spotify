import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

// Load environment variables from .env.local
dotenv.config({ path: resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey) {
  console.error("Missing Supabase credentials in .env.local");
  process.exit(1);
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey);

const sampleReviews = [
  // Reddit
  { platform: 'Reddit', source: 'r/spotify', rating: null, review_text: "Discover Weekly used to be amazing but now it just plays the same 20 artists over and over. I feel like the algorithm is too scared to show me anything actually new.", review_url: "https://reddit.com/r/spotify/comments/1", posted_at: new Date().toISOString() },
  { platform: 'Reddit', source: 'r/truespotify', rating: null, review_text: "Playlist fatigue is real. Every generated playlist feels identical. Why do my Daily Mixes have the exact same songs as last week?", review_url: "https://reddit.com/r/truespotify/comments/2", posted_at: new Date().toISOString() },
  { platform: 'Reddit', source: 'r/spotify', rating: null, review_text: "I wish I could control my discovery. Like a slider for 'more obscure' vs 'more popular'. Right now it just traps me in an echo chamber of my recent listening.", review_url: "https://reddit.com/r/spotify/comments/3", posted_at: new Date().toISOString() },
  { platform: 'Reddit', source: 'r/music', rating: null, review_text: "Spotify's repetitive recommendations are killing my love for exploring new genres. Once I listen to one jazz song, my entire feed becomes jazz for a month.", review_url: "https://reddit.com/r/music/comments/4", posted_at: new Date().toISOString() },
  { platform: 'Reddit', source: 'r/truespotify', rating: null, review_text: "Does anyone else notice that 'Smart Shuffle' is just 'dumb shuffle' with the same 5 popular songs injected every time?", review_url: "https://reddit.com/r/truespotify/comments/5", posted_at: new Date().toISOString() },
  { platform: 'Reddit', source: 'r/spotify', rating: null, review_text: "I want music that feels fresh but still relevant. Discover Weekly is becoming predictable. It used to feel like magic.", review_url: "https://reddit.com/r/spotify/comments/6", posted_at: new Date().toISOString() },
  { platform: 'Reddit', source: 'r/LetsTalkMusic', rating: null, review_text: "The lack of exploration control on Spotify is frustrating. I have to actively use outside websites to find new artists because the built-in tools just recycle.", review_url: "https://reddit.com/r/LetsTalkMusic/comments/7", posted_at: new Date().toISOString() },
  { platform: 'Reddit', source: 'r/truespotify', rating: null, review_text: "My release radar is broken. It gives me remixes of songs I already know instead of actual new releases by artists I follow.", review_url: "https://reddit.com/r/truespotify/comments/8", posted_at: new Date().toISOString() },
  { platform: 'Reddit', source: 'r/spotify', rating: null, review_text: "Same songs appearing again and again in every radio station I start. What's the point of radio if it's just my liked songs playlist?", review_url: "https://reddit.com/r/spotify/comments/9", posted_at: new Date().toISOString() },
  { platform: 'Reddit', source: 'r/truespotify', rating: null, review_text: "Poor new artist discovery on the platform right now. It strongly favors established artists even when you explicitly look for indie.", review_url: "https://reddit.com/r/truespotify/comments/10", posted_at: new Date().toISOString() },
  
  // Play Store
  { platform: 'Play Store', source: 'Google Play', rating: 3, review_text: "App is fine, but the recommendations are stale. I listen to a lot of music and I'm tired of seeing the same bands pushed to me every day.", review_url: null, posted_at: new Date().toISOString() },
  { platform: 'Play Store', source: 'Google Play', rating: 2, review_text: "Discover Weekly is literally the same artists every week. It used to be exciting but now it's so predictable.", review_url: null, posted_at: new Date().toISOString() },
  { platform: 'Play Store', source: 'Google Play', rating: 4, review_text: "Love Spotify but I rarely find new music anymore. It just recycles artists I already know. Please fix the algorithm.", review_url: null, posted_at: new Date().toISOString() },
  { platform: 'Play Store', source: 'Google Play', rating: 1, review_text: "Why do you keep pushing podcasts when I just want to discover new music? The music discovery features have been buried.", review_url: null, posted_at: new Date().toISOString() },
  { platform: 'Play Store', source: 'Google Play', rating: 3, review_text: "Daily mix repetition is a huge issue. Mix 1 and Mix 3 often have the same overlapping artists. Needs more variety.", review_url: null, posted_at: new Date().toISOString() },
  { platform: 'Play Store', source: 'Google Play', rating: 2, review_text: "It feels impossible to break out of the algorithm's pigeonhole. If I listen to lo-fi once to study, my whole discovery page is ruined.", review_url: null, posted_at: new Date().toISOString() },
  { platform: 'Play Store', source: 'Google Play', rating: 4, review_text: "Great for listening to what I know, awful for finding what I don't. The 'Fans also like' section is just the most mainstream artists in that genre.", review_url: null, posted_at: new Date().toISOString() },
  { platform: 'Play Store', source: 'Google Play', rating: 3, review_text: "I want an option to exclude certain artists from my discovery algorithms without having to block them completely.", review_url: null, posted_at: new Date().toISOString() },
  { platform: 'Play Store', source: 'Google Play', rating: 2, review_text: "I miss the old Spotify where discovery felt organic. Now it feels like labels are just paying for placement in my generated playlists.", review_url: null, posted_at: new Date().toISOString() },
  { platform: 'Play Store', source: 'Google Play', rating: 1, review_text: "Stop playing the same 5 songs after my albums finish. The autoplay feature is so repetitive it's infuriating.", review_url: null, posted_at: new Date().toISOString() },
  
  // App Store
  { platform: 'App Store', source: 'Apple App Store', rating: 3, review_text: "My Daily Mix feels like the same playlist shuffled in a different order. I want true discovery, not a reshuffle.", review_url: null, posted_at: new Date().toISOString() },
  { platform: 'App Store', source: 'Apple App Store', rating: 4, review_text: "The UI is clean, but finding fresh music is a chore. I rely on friends for recommendations now because the app's suggestions are too safe.", review_url: null, posted_at: new Date().toISOString() },
  { platform: 'App Store', source: 'Apple App Store', rating: 2, review_text: "Algorithm is stuck in a loop. I've been getting the same 'Discover Weekly' vibe for 6 months. How do I reset it?", review_url: null, posted_at: new Date().toISOString() },
  { platform: 'App Store', source: 'Apple App Store', rating: 3, review_text: "I wish Spotify had a 'surprise me' button that completely ignored my listening history for a day.", review_url: null, posted_at: new Date().toISOString() },
  { platform: 'App Store', source: 'Apple App Store', rating: 1, review_text: "Release radar is terrible. It constantly misses new albums from indie artists I follow but makes sure I see every major label pop release.", review_url: null, posted_at: new Date().toISOString() },
  { platform: 'App Store', source: 'Apple App Store', rating: 3, review_text: "Good app, but the generated playlists are suffering from severe playlist fatigue. They all blend together now.", review_url: null, posted_at: new Date().toISOString() },
  { platform: 'App Store', source: 'Apple App Store', rating: 2, review_text: "Why does the Spotify algorithm assume that because I like one song by an artist, I want to hear their entire discography on every radio station?", review_url: null, posted_at: new Date().toISOString() },
  { platform: 'App Store', source: 'Apple App Store', rating: 4, review_text: "I love the year in review, but the daily discovery tools are lacking. Too much repetition.", review_url: null, posted_at: new Date().toISOString() },
  { platform: 'App Store', source: 'Apple App Store', rating: 2, review_text: "It feels like there's a lack of exploration control. You just get what you're given and you can't tweak the parameters of the discovery engine.", review_url: null, posted_at: new Date().toISOString() },
  { platform: 'App Store', source: 'Apple App Store', rating: 3, review_text: "Please add a feature to tell the algorithm 'I like this, but stop playing it so much'. It burns out songs too quickly.", review_url: null, posted_at: new Date().toISOString() },
];

async function seed() {
  console.log('Seeding reviews...');
  const { data, error } = await supabaseAdmin.from('raw_reviews').insert(sampleReviews);
  
  if (error) {
    console.error('Error seeding reviews:', error);
  } else {
    console.log(`Successfully seeded ${sampleReviews.length} reviews.`);
  }
}

seed().catch(console.error);
