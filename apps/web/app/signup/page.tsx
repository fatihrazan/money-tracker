import { AuthForm } from '../../components/auth-form';
import { googleConfigured } from '../../lib/google';
export const dynamic = 'force-dynamic';
export default function Page() {
  return <AuthForm signup googleEnabled={googleConfigured()} />;
}
