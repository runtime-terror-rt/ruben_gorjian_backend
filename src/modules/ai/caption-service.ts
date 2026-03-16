import OpenAI from "openai";
import { logger } from "../../lib/logger";
import { prisma } from "../../lib/prisma";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export interface CaptionRequest {
  assetId: string;
  userId: string;
  style?: "storytelling" | "design-focused" | "minimalist";
  platforms?: string[];
}

export interface CaptionResponse {
  captions: string[];
  hashtags: string[];
  ctas: string[];
  description: string;
}

export class AICaptionService {
  async generateCaptions(request: CaptionRequest): Promise<CaptionResponse> {
    // Get asset and user brand profile
    const [asset, brandProfile] = await Promise.all([
      prisma.asset.findFirst({
        where: { id: request.assetId, userId: request.userId }
      }),
      prisma.brandProfile.findFirst({
        where: { userId: request.userId }
      })
    ]);

    if (!asset) {
      throw new Error("Asset not found");
    }

    // Get image URL (assuming we have a way to get the full URL)
    const imageUrl = `${process.env.STORAGE_BASE_URL}/${asset.storageKey}`;

    // Create brand-aware prompt
    const prompt = this.createPrompt(brandProfile, request.style, request.platforms);

    try {
      const response = await openai.chat.completions.create({
        model: "gpt-4-vision-preview",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: prompt
              },
              {
                type: "image_url",
                image_url: {
                  url: imageUrl,
                  detail: "high"
                }
              }
            ]
          }
        ],
        max_tokens: 1000,
        temperature: 0.7
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error("No response from AI");
      }

      return this.parseAIResponse(content);
    } catch (error) {
      logger.error("AI caption generation failed", error);
      throw new Error("Failed to generate captions");
    }
  }

  private createPrompt(brandProfile: any, style?: string, platforms?: string[]): string {
    const basePrompt = `Analyze this image and create social media content. Return a JSON response with this exact structure:

{
  "captions": ["caption1", "caption2", "caption3"],
  "hashtags": ["hashtag1", "hashtag2", "hashtag3", "hashtag4", "hashtag5", "hashtag6", "hashtag7", "hashtag8", "hashtag9", "hashtag10", "hashtag11", "hashtag12", "hashtag13", "hashtag14", "hashtag15", "hashtag16", "hashtag17", "hashtag18", "hashtag19", "hashtag20"],
  "ctas": ["cta1", "cta2", "cta3"],
  "description": "short description"
}

Requirements:
- 3 different caption variants (${style || "varied styles"})
- 20 relevant hashtags
- 3 call-to-action options
- 1 short description (max 50 words)`;

    let contextPrompt = basePrompt;

    if (brandProfile) {
      contextPrompt += `\n\nBrand Context:
- Industry: ${brandProfile.industry || "General"}
- Business Type: ${brandProfile.businessType || "B2C"}
- Target Audience: ${brandProfile.targetAudience || "General audience"}
- Brand Tone: ${brandProfile.brandTone || "Professional"}
- Preferred CTAs: ${brandProfile.ctaPreferences || "Shop now, Learn more, Contact us"}`;
    }

    if (platforms?.length) {
      contextPrompt += `\n\nOptimize for platforms: ${platforms.join(", ")}`;
    }

    contextPrompt += `\n\nStyle Guidelines:
- storytelling: Narrative-driven, emotional connection
- design-focused: Highlight visual elements, aesthetics
- minimalist: Clean, simple, direct messaging

Return only valid JSON, no additional text.`;

    return contextPrompt;
  }

  private parseAIResponse(content: string): CaptionResponse {
    try {
      // Clean the response to extract JSON
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error("No JSON found in response");
      }

      const parsed = JSON.parse(jsonMatch[0]);
      
      // Validate structure
      if (!parsed.captions || !Array.isArray(parsed.captions) || parsed.captions.length !== 3) {
        throw new Error("Invalid captions format");
      }
      
      if (!parsed.hashtags || !Array.isArray(parsed.hashtags) || parsed.hashtags.length !== 20) {
        throw new Error("Invalid hashtags format");
      }
      
      if (!parsed.ctas || !Array.isArray(parsed.ctas) || parsed.ctas.length !== 3) {
        throw new Error("Invalid CTAs format");
      }

      return {
        captions: parsed.captions,
        hashtags: parsed.hashtags.map((tag: string) => tag.startsWith('#') ? tag : `#${tag}`),
        ctas: parsed.ctas,
        description: parsed.description || ""
      };
    } catch (error) {
      logger.error("Failed to parse AI response", error);
      
      // Fallback response
      return {
        captions: [
          "Check out this amazing content! ✨",
          "Loving the vibes in this shot 📸",
          "Something special to brighten your day 🌟"
        ],
        hashtags: [
          "#content", "#social", "#amazing", "#vibes", "#photography",
          "#inspiration", "#creative", "#lifestyle", "#beautiful", "#trending",
          "#follow", "#like", "#share", "#explore", "#discover",
          "#daily", "#mood", "#aesthetic", "#quality", "#professional"
        ],
        ctas: [
          "Double tap if you agree! ❤️",
          "What do you think? Comment below! 💬",
          "Save this for later! 📌"
        ],
        description: "Engaging social media content"
      };
    }
  }

  async saveContentItem(userId: string, assetId: string, captionData: CaptionResponse) {
    return prisma.contentItem.create({
      data: {
        userId,
        assetId,
        captionVariants: captionData.captions,
        hashtags: captionData.hashtags,
        ctas: captionData.ctas,
        shortDescription: captionData.description
      }
    });
  }
}
