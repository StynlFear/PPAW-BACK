type AuthConfig = {
  jwtSecret: string;
  jwtExpiresIn: import("jsonwebtoken").SignOptions["expiresIn"];
};

export function getAuthConfig(): AuthConfig {
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret || jwtSecret.trim() === "") {
    throw new Error("JWT_SECRET is required");
  }

  return {
    jwtSecret,
    jwtExpiresIn: (process.env.JWT_EXPIRES_IN?.trim() || "7d") as import("jsonwebtoken").SignOptions["expiresIn"],
  };
}
