import AuthPage from '../components/AuthPage';

export default function SignupPage({ onAuthenticate }) {
  return <AuthPage mode="signup" onAuthenticate={onAuthenticate} />;
}
