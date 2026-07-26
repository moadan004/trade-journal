"use client";

import { GoogleLogin, GoogleOAuthProvider, type CredentialResponse } from "@react-oauth/google";
import { useRouter } from "next/navigation";

import { ApiError, googleAuth } from "@/lib/api";
import { setToken } from "@/lib/auth";

const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "";
const PLACEHOLDER_CLIENT_ID = "your-client-id.apps.googleusercontent.com";

interface GoogleSignInButtonProps {
  onError: (message: string) => void;
}

export function GoogleSignInButton({ onError }: GoogleSignInButtonProps) {
  const router = useRouter();

  if (!GOOGLE_CLIENT_ID || GOOGLE_CLIENT_ID === PLACEHOLDER_CLIENT_ID) {
    return (
      <p className="text-center text-xs text-zinc-400 dark:text-zinc-500">
        Google sign-in isn&apos;t configured yet — set NEXT_PUBLIC_GOOGLE_CLIENT_ID to enable it
        (see README).
      </p>
    );
  }

  function handleSuccess(credentialResponse: CredentialResponse) {
    const idToken = credentialResponse.credential;
    if (!idToken) {
      onError("Google didn't return a credential.");
      return;
    }

    googleAuth(idToken)
      .then(({ access_token }) => {
        setToken(access_token);
        router.push("/dashboard");
      })
      .catch((err) => onError(err instanceof ApiError ? err.message : "Google sign-in failed."));
  }

  return (
    <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
      <div className="flex justify-center">
        <GoogleLogin onSuccess={handleSuccess} onError={() => onError("Google sign-in failed.")} width="320" />
      </div>
    </GoogleOAuthProvider>
  );
}
