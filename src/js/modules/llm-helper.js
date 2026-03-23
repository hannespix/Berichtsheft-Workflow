const LLMHelper = {
  getConfig() {
    return {
      provider: App.scalar("SELECT wert FROM einstellungen WHERE schluessel='llm_provider'") || 'claude',
      model: App.scalar("SELECT wert FROM einstellungen WHERE schluessel='llm_model'") || 'gpt-5.4',
      apiKey: App.scalar("SELECT wert FROM einstellungen WHERE schluessel='llm_api_key'") || '',
      url: App.scalar("SELECT wert FROM einstellungen WHERE schluessel='llm_url'") || 'http://localhost:11434',
    };
  },

  // call(prompt) – text only (for simple tasks, test)
  async call(prompt) { return this.callVision(prompt, []); },

  // callVision(prompt, images[]) – text + images
  // images: [{base64, mediaType}]
  async callVision(prompt, images) {
    const cfg = this.getConfig();
    if (!cfg.apiKey && cfg.provider !== 'ollama') throw new Error('Kein API-Key hinterlegt (Einstellungen → KI)');
    images = images || [];

    if (cfg.provider === 'claude') {
      const content = [];
      images.forEach(img => content.push({ type: 'image', source: { type: 'base64', media_type: img.mediaType || 'image/png', data: img.base64 } }));
      content.push({ type: 'text', text: prompt });
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': cfg.apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
        body: JSON.stringify({ model: cfg.model, max_tokens: 4000, messages: [{ role: 'user', content }] })
      });
      const data = await resp.json();
      if (data.error) throw new Error(data.error.message);
      return data.content?.map(c => c.text || '').join('') || '';
    }

    if (cfg.provider === 'openai') {
      const content = [];
      images.forEach(img => content.push({ type: 'image_url', image_url: { url: `data:${img.mediaType||'image/png'};base64,${img.base64}` } }));
      content.push({ type: 'text', text: prompt });
      const resp = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${cfg.apiKey}` },
        body: JSON.stringify({ model: cfg.model, max_completion_tokens: 4000, messages: [{ role: 'user', content }] })
      });
      const data = await resp.json();
      if (data.error) throw new Error(data.error.message);
      return data.choices?.[0]?.message?.content || '';
    }

    if (cfg.provider === 'gemini') {
      const parts = [];
      images.forEach(img => parts.push({ inline_data: { mime_type: img.mediaType || 'image/png', data: img.base64 } }));
      parts.push({ text: prompt });
      const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${cfg.model}:generateContent?key=${cfg.apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts }] })
      });
      const data = await resp.json();
      if (data.error) throw new Error(data.error.message);
      return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    }

    if (cfg.provider === 'ollama') {
      const body = { model: cfg.model, prompt, stream: false };
      if (images.length) body.images = images.map(img => img.base64);
      const resp = await fetch(`${cfg.url}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await resp.json();
      return data.response || '';
    }

    throw new Error('Unbekannter Anbieter: ' + cfg.provider);
  }
};
