import { listModels } from './gemini';
import { getSettings, setSettings } from './settings';

/**
 * Fetch the models this key can use now and save them. Google retires models
 * over time; if the chosen one is gone, the best available one is chosen.
 */
export async function refreshModelList(key: string): Promise<string[]> {
  const names = (await listModels(key)).map((m) => m.name);
  if (!names.length) return [];
  const s = getSettings();
  setSettings({
    geminiModels: names,
    ...(s.geminiModel && names.includes(s.geminiModel) ? {} : { geminiModel: names[0] }),
  });
  return names;
}
