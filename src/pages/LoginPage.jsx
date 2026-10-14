import AuthPage from '../components/AuthPage';

export default function LoginPage({ onAuthenticate }) {
  return <AuthPage mode="login" onAuthenticate={onAuthenticate} />;
}
