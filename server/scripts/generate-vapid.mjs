import { generateVapidKeys } from '@mmmike/web-push/vapid';

const { publicKey, privateKey } = await generateVapidKeys();
console.log('\nVAPID_PUBLIC_KEY=');
console.log(publicKey);
console.log('\nVAPID_PRIVATE_KEY_JSON=');
console.log(JSON.stringify(privateKey));
console.log('\n중요: private key는 Cloudflare Worker Secret에만 저장하고 앱/깃허브/채팅에 올리지 마세요.');
