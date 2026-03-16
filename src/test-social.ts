import { SocialOAuthService } from "./modules/social/oauth";
import { SocialAccountService } from "./modules/social/service";
import { SocialPublisher } from "./modules/social/publisher";

async function testSocialIntegration() {
  console.log("🧪 Testing Social Media Integration...\n");

  // Test OAuth URL generation
  console.log("1. Testing OAuth URL generation:");
  const oauthService = new SocialOAuthService();
  
  try {
    const instagramUrl = oauthService.getAuthUrl("INSTAGRAM", "test-user-id");
    const facebookUrl = oauthService.getAuthUrl("FACEBOOK", "test-user-id");
    const linkedinUrl = oauthService.getAuthUrl("LINKEDIN", "test-user-id");
    
    console.log("✅ Instagram OAuth URL:", instagramUrl.substring(0, 80) + "...");
    console.log("✅ Facebook OAuth URL:", facebookUrl.substring(0, 80) + "...");
    console.log("✅ LinkedIn OAuth URL:", linkedinUrl.substring(0, 80) + "...");
  } catch (error) {
    console.log("❌ OAuth URL generation failed:", error);
  }

  console.log("\n2. Testing environment variables:");
  const requiredEnvVars = [
    "META_APP_ID",
    "META_APP_SECRET", 
    "LINKEDIN_CLIENT_ID",
    "LINKEDIN_CLIENT_SECRET"
  ];

  requiredEnvVars.forEach(envVar => {
    const value = process.env[envVar];
    if (value && value !== "") {
      console.log(`✅ ${envVar}: Set (${value.substring(0, 10)}...)`);
    } else {
      console.log(`❌ ${envVar}: Missing or empty`);
    }
  });

  console.log("\n3. Testing database connection:");
  const socialService = new SocialAccountService();
  
  try {
    // This will test the database connection
    await socialService.getUserSocialAccounts("test-user-id");
    console.log("✅ Database connection working");
  } catch (error) {
    console.log("❌ Database connection failed:", error);
  }

  console.log("\n4. Testing publisher initialization:");
  try {
    const publisher = new SocialPublisher();
    console.log("✅ Social publisher initialized");
  } catch (error) {
    console.log("❌ Publisher initialization failed:", error);
  }

  console.log("\n🎉 Social integration test complete!");
  console.log("\nNext steps:");
  console.log("1. Set up OAuth apps (see OAUTH_SETUP.md)");
  console.log("2. Add environment variables to .env");
  console.log("3. Test OAuth flow with real credentials");
  console.log("4. Connect social accounts via frontend");
}

// Run the test
testSocialIntegration().catch(console.error);
