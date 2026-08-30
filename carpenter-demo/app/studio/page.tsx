import StudioPanel from '@/components/StudioPanel';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

export default function StudioPage() {
  return <StudioPanel enabled={process.env.STUDIO_ENABLED === 'true'} />;
}
