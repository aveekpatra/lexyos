import type { Metadata } from "next";
import { Lato, DM_Sans } from "next/font/google";
import "./globals.css";
import ConvexClientProvider from "@/components/ConvexClientProvider";
import { ClerkProvider } from "@clerk/nextjs";

const lato = Lato({
  variable: "--font-sans",
  weight: ["300", "400", "700", "900"],
  subsets: ["latin"],
});

const dmSans = DM_Sans({
  variable: "--font-heading",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "UniFocus",
  description: "AI-powered productivity system",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body
        className={`${dmSans.variable} ${lato.variable} antialiased`}
      >
        <ClerkProvider
          dynamic
          appearance={{
            baseTheme: undefined,
          }}
        >
          <ConvexClientProvider>{children}</ConvexClientProvider>
        </ClerkProvider>
      </body>
    </html>
  );
}
