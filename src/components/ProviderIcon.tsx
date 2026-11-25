import {
  Boxes,
  Cloud,
  Code2,
  Compass,
  Cpu,
  Flower2,
  Layers,
  Orbit,
  Server,
  Sparkles,
  Terminal,
  Wind,
  Zap,
} from 'lucide-react';

interface ProviderIconProps {
  providerId: string;
  className?: string;
}

export function ProviderIcon({ providerId, className = 'w-4 h-4' }: ProviderIconProps) {
  switch (providerId) {
    case 'openrouter':
      return <Layers className={className} />;
    case 'gemini':
      return <Sparkles className={className} />;
    case 'groq':
      return <Zap className={className} />;
    case 'sambanova':
      return <Cpu className={className} />;
    case 'mistral':
      return <Wind className={className} />;
    case 'cohere':
      return <Compass className={className} />;
    case 'nvidia':
      return <Terminal className={className} />;
    case 'cloudflare':
      return <Cloud className={className} />;
    case 'kilo':
      return <Code2 className={className} />;
    case 'siliconflow':
      return <Boxes className={className} />;
    case 'zai':
      return <Orbit className={className} />;
    case 'pollinations':
      return <Flower2 className={className} />;
    default:
      return <Server className={className} />;
  }
}
