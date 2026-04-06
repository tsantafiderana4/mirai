import fs from 'fs';

async function test() {
  const envFile = fs.readFileSync('./.env', 'utf-8');
  const apiKey = envFile.split('\n').find(line => line.startsWith('VITE_GEMINI_API_KEY='))?.split('=')[1];
  
  if (!apiKey) {
    console.log('No API key found');
    return;
  }

  const BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";
  const model = "gemini-2.5-flash-preview-tts";
  const text = "Hello world";
  const voiceName = "Kore";

  const payload = {
      contents: [{ parts: [{ text: text }] }],
      generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voiceName || 'Kore' } } } }
  }

  const res = await fetch(`${BASE_URL}/${model}:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
  })

  if (!res.ok) {
    console.log("Error:", await res.text());
  } else {
    console.log("Success");
  }
}

test();
