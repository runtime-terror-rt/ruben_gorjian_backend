import { SocialPlatform } from "@prisma/client";
import { SocialAccountService } from "./service";
import { logger } from "../../lib/logger";
import crypto from "crypto";

interface PostContent {
  text: string;
  mediaUrl?: string;
  mediaType?: "image" | "video";
  mediaUrls?: Array<{ url: string; type: "image" | "video" }>;
}

interface PublishResult {
  success: boolean;
  externalPostId?: string;
  error?: string;
}

export class SocialPublisher {
  private socialService = new SocialAccountService();
  private getAppSecretProof(accessToken: string) {
    const secret =
      process.env.META_APP_SECRET ||
      process.env.INSTAGRAM_APP_SECRET ||
      process.env.FACEBOOK_APP_SECRET; // backward-compat if named differently
    if (!secret) return null;
    return crypto.createHmac("sha256", secret).update(accessToken).digest("hex");
  }

  async publishPost(
    socialAccountId: string, 
    content: PostContent
  ): Promise<PublishResult> {
    try {
      const accessToken = await this.socialService.getValidAccessToken(socialAccountId);
      if (!accessToken) {
        return { success: false, error: "Invalid or expired access token" };
      }

      // Get account details to determine platform
      const account = await this.socialService.refreshTokenIfNeeded(socialAccountId);
      if (!account) {
        return { success: false, error: "Social account not found" };
      }

      switch (account.platform) {
        case "INSTAGRAM":
          return this.publishToInstagram(account.externalAccountId, accessToken, content);
        case "FACEBOOK": {
          // For Facebook, ensure we use Page access token
          const pageToken = await this.socialService.getPageAccessTokenForFacebook(
            socialAccountId,
            account.externalAccountId
          );
          const effectiveToken = pageToken || accessToken;
          return this.publishToFacebook(account.externalAccountId, effectiveToken, content);
        }
        case "LINKEDIN":
          return this.publishToLinkedIn(account.externalAccountId, accessToken, content);
        default:
          return { success: false, error: "Unsupported platform" };
      }
    } catch (error) {
      logger.error("Publish error", error);
      return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
    }
  }

  private async publishToInstagram(
    accountId: string, 
    accessToken: string, 
    content: PostContent
  ): Promise<PublishResult> {
    try {
      const appsecretProof = this.getAppSecretProof(accessToken);
      
      // Apply Instagram caption limit (2200 characters)
      const INSTAGRAM_CAPTION_LIMIT = 2200;
      let caption = content.text || "";
      if (caption.length > INSTAGRAM_CAPTION_LIMIT) {
        logger.warn("Caption exceeds Instagram limit, truncating", {
          accountId,
          originalLength: caption.length,
          limit: INSTAGRAM_CAPTION_LIMIT,
        });
        caption = caption.substring(0, INSTAGRAM_CAPTION_LIMIT);
      }
      
      // Support multiple media (carousel) or single media
      const mediaItems = content.mediaUrls && content.mediaUrls.length > 0
        ? content.mediaUrls
        : content.mediaUrl && content.mediaType
          ? [{ url: content.mediaUrl, type: content.mediaType }]
          : [];

      if (mediaItems.length === 0) {
        return { success: false, error: "Instagram requires an image or video asset" };
      }

      // For single media, use the existing flow
      if (mediaItems.length === 1) {
        const media = mediaItems[0];
        const isVideo = media.type === "video";
        
        // Validate media type is set
        if (!media.type || (media.type !== "image" && media.type !== "video")) {
          logger.error("Invalid media type for Instagram", { mediaType: media.type, url: media.url.substring(0, 100) });
          return { success: false, error: `Invalid media type: ${media.type}. Must be 'image' or 'video'.` };
        }
        
        const mediaUrl = new URL(`https://graph.facebook.com/v18.0/${accountId}/media`);
        mediaUrl.searchParams.set("access_token", accessToken);
        if (appsecretProof) mediaUrl.searchParams.set("appsecret_proof", appsecretProof);

        const containerPayload: Record<string, any> = {
          caption: caption, // Use truncated caption
          ...(isVideo
            ? { video_url: media.url, media_type: "VIDEO" }
            : { image_url: media.url, media_type: "IMAGE" })
        };

        logger.info("Creating Instagram media container", {
          accountId,
          isVideo,
          hasUrl: !!media.url,
          urlPreview: media.url.substring(0, 100)
        });

        const containerResponse = await fetch(mediaUrl.toString(), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(containerPayload)
        });

        const containerData = await containerResponse.json() as any;
        if (!containerResponse.ok) {
          logger.error("Instagram media container creation failed", {
            error: containerData.error,
            payload: { ...containerPayload, video_url: containerPayload.video_url ? "[REDACTED]" : undefined, image_url: containerPayload.image_url ? "[REDACTED]" : undefined },
            isVideo,
            responseStatus: containerResponse.status,
            fullResponse: JSON.stringify(containerData),
          });
          return { success: false, error: containerData.error?.message || "Failed to create media container" };
        }

        // Verify we got a container ID
        if (!containerData.id) {
          logger.error("Instagram container creation succeeded but no container ID returned", {
            accountId,
            isVideo,
            containerResponse: JSON.stringify(containerData),
            responseStatus: containerResponse.status,
          });
          return { success: false, error: "Container ID is not available. Container creation may have failed." };
        }

        // Wait for container to be ready (both images and videos need processing time)
        // Instagram requires containers to be in "FINISHED" status before publishing
        let status = "IN_PROGRESS";
        let attempts = 0;
        const maxAttempts = isVideo ? 30 : 20; // Increased for images - they can take 15-20 seconds
        
        logger.info("Waiting for Instagram container to be ready", {
          accountId,
          containerId: containerData.id,
          isVideo,
        });
        
        while (status === "IN_PROGRESS" && attempts < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, isVideo ? 2000 : 1500));
          const statusUrl = new URL(`https://graph.facebook.com/v18.0/${containerData.id}`);
          statusUrl.searchParams.set("access_token", accessToken);
          statusUrl.searchParams.set("fields", "status_code");
          if (appsecretProof) statusUrl.searchParams.set("appsecret_proof", appsecretProof);
          
          const statusResponse = await fetch(statusUrl.toString());
          const statusData = await statusResponse.json() as any;
          
          if (!statusResponse.ok) {
            logger.warn("Failed to check container status, will retry", {
              accountId,
              containerId: containerData.id,
              error: statusData.error,
              attempt: attempts + 1,
            });
            attempts++;
            continue; // Retry status check
          }
          
          status = statusData.status_code;
          attempts++;
          
          if (status === "ERROR") {
            logger.error("Container processing failed", {
              accountId,
              containerId: containerData.id,
              statusData,
            });
            return { success: false, error: "Media processing failed. Please try again." };
          }
          
          if (status === "FINISHED") {
            logger.info("Container is ready for publishing", {
              accountId,
              containerId: containerData.id,
              attempts,
              isVideo,
            });
            break;
          }
        }
        
        // If still not finished, wait a bit more before attempting publish
        if (status !== "FINISHED") {
          logger.warn("Container not finished after max attempts, waiting additional time", {
            accountId,
            containerId: containerData.id,
            status,
            attempts,
            isVideo,
          });
          // Wait additional 3 seconds before attempting publish
          await new Promise(resolve => setTimeout(resolve, 3000));
        }

        // Publish the container
        const publishUrl = new URL(`https://graph.facebook.com/v18.0/${accountId}/media_publish`);
        publishUrl.searchParams.set("access_token", accessToken);
        publishUrl.searchParams.set("creation_id", containerData.id);
        // Note: fields parameter is for GET requests, not POST. POST to media_publish returns id by default.
        if (appsecretProof) publishUrl.searchParams.set("appsecret_proof", appsecretProof);

        const publishResponse = await fetch(publishUrl.toString(), {
          method: "POST",
        });

        const publishData = await publishResponse.json() as any;
        if (!publishResponse.ok) {
          // Handle specific error code 9007 - media not ready
          if (publishData.error?.code === 9007 || publishData.error?.error_subcode === 2207027) {
            logger.warn("Media not ready, checking status and retrying", {
              accountId,
              containerId: containerData.id,
              error: publishData.error,
            });
            
            // Check container status again and wait for it to be ready
            let retryStatus = "IN_PROGRESS";
            let retryAttempts = 0;
            const maxRetryAttempts = 10;
            
            while (retryStatus === "IN_PROGRESS" && retryAttempts < maxRetryAttempts) {
              await new Promise(resolve => setTimeout(resolve, 2000));
              const statusUrl = new URL(`https://graph.facebook.com/v18.0/${containerData.id}`);
              statusUrl.searchParams.set("access_token", accessToken);
              statusUrl.searchParams.set("fields", "status_code");
              if (appsecretProof) statusUrl.searchParams.set("appsecret_proof", appsecretProof);
              
              const statusResponse = await fetch(statusUrl.toString());
              const statusData = await statusResponse.json() as any;
              
              if (statusResponse.ok && statusData.status_code) {
                retryStatus = statusData.status_code;
                if (retryStatus === "FINISHED") {
                  logger.info("Container is now ready after retry wait", {
                    accountId,
                    containerId: containerData.id,
                    retryAttempts,
                  });
                  break;
                }
                if (retryStatus === "ERROR") {
                  return { success: false, error: "Media processing failed. Please try again." };
                }
              }
              retryAttempts++;
            }
            
            // Wait a bit more before retry
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            const retryResponse = await fetch(publishUrl.toString(), {
              method: "POST",
            });
            
            const retryData = await retryResponse.json() as any;
            if (!retryResponse.ok) {
              logger.error("Instagram publish failed after retry", {
                accountId,
                containerId: containerData.id,
                error: retryData.error,
                responseStatus: retryResponse.status,
                fullResponse: JSON.stringify(retryData),
              });
              return { 
                success: false, 
                error: retryData.error?.error_user_msg || retryData.error?.message || "Media is not ready for publishing. Please try again in a moment." 
              };
            }
            
            // Use retry response data
            const retryMediaId = retryData.id || retryData.data?.id || retryData.media_id;
            if (retryMediaId) {
              logger.info("Instagram post published successfully after retry", {
                accountId,
                containerId: containerData.id,
                mediaId: retryMediaId,
              });
              return { success: true, externalPostId: retryMediaId };
            }
          }
          
          logger.error("Instagram publish failed", {
            accountId,
            containerId: containerData.id,
            error: publishData.error,
            responseStatus: publishResponse.status,
            fullResponse: JSON.stringify(publishData),
          });
          return { 
            success: false, 
            error: publishData.error?.error_user_msg || publishData.error?.message || "Failed to publish post" 
          };
        }

        // Verify we got a media ID - check multiple possible response formats
        const mediaId = publishData.id || publishData.data?.id || publishData.media_id;
        if (!mediaId) {
          logger.error("Instagram publish succeeded but no media ID returned", {
            accountId,
            containerId: containerData.id,
            publishResponse: JSON.stringify(publishData),
            responseStatus: publishResponse.status,
            responseHeaders: Object.fromEntries(publishResponse.headers.entries()),
          });
          return { success: false, error: "Media ID is not available. Publish may have succeeded but ID was not returned." };
        }

        logger.info("Instagram post published successfully", {
          accountId,
          containerId: containerData.id,
          mediaId: mediaId,
        });

        return { success: true, externalPostId: mediaId };
      }

      // For multiple media, create a carousel (only images supported for carousel)
      const imageItems = mediaItems.filter(m => m.type === "image");
      if (imageItems.length < 2) {
        logger.error("Instagram carousel validation failed", {
          accountId,
          totalMediaItems: mediaItems.length,
          imageCount: imageItems.length,
          videoCount: mediaItems.filter(m => m.type === "video").length,
        });
        return { success: false, error: "Instagram carousel requires at least 2 images. Received " + imageItems.length + " image(s) and " + mediaItems.filter(m => m.type === "video").length + " video(s)." };
      }
      
      if (imageItems.length > 10) {
        logger.error("Instagram carousel validation failed - too many images", {
          accountId,
          imageCount: imageItems.length,
        });
        return { success: false, error: "Instagram carousel supports maximum 10 images. Received " + imageItems.length + " images." };
      }
      
      logger.info("Creating Instagram carousel", {
        accountId,
        imageCount: imageItems.length,
      });

      // Create media containers for each image (carousel items)
      const containerIds: string[] = [];
      for (let i = 0; i < imageItems.length; i++) {
        const media = imageItems[i];
        const mediaUrl = new URL(`https://graph.facebook.com/v18.0/${accountId}/media`);
        mediaUrl.searchParams.set("access_token", accessToken);
        if (appsecretProof) mediaUrl.searchParams.set("appsecret_proof", appsecretProof);

        logger.info("Creating Instagram carousel item", {
          accountId,
          itemIndex: i + 1,
          totalItems: imageItems.length,
          imageUrl: media.url.substring(0, 150), // Log first 150 chars
        });

        const containerPayload: Record<string, any> = {
          image_url: media.url,
          is_carousel_item: true,
          // Only first carousel item gets caption (Instagram requirement)
          ...(i === 0 ? { caption: caption } : {})
        };

        const containerResponse = await fetch(mediaUrl.toString(), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(containerPayload)
        });

        const containerData = await containerResponse.json() as any;
        if (!containerResponse.ok) {
          logger.error("Instagram carousel item creation failed", {
            accountId,
            itemIndex: i + 1,
            totalItems: imageItems.length,
            error: containerData.error,
            errorCode: containerData.error?.code,
            errorSubcode: containerData.error?.error_subcode,
            urlPreview: media.url.substring(0, 100),
          });
          return { 
            success: false, 
            error: containerData.error?.message || `Failed to create carousel item ${i + 1} of ${imageItems.length}. Error code: ${containerData.error?.code || "unknown"}` 
          };
        }

        if (!containerData.id) {
          logger.error("Instagram carousel item missing ID", {
            accountId,
            itemIndex: i + 1,
            response: containerData,
          });
          return { 
            success: false, 
            error: `Carousel item ${i + 1} was created but no container ID was returned` 
          };
        }
        
        containerIds.push(containerData.id);
      }
      
      if (containerIds.length !== imageItems.length) {
        logger.error("Instagram carousel container ID mismatch", {
          accountId,
          expectedCount: imageItems.length,
          actualCount: containerIds.length,
        });
        return { 
          success: false, 
          error: `Failed to create all carousel items. Expected ${imageItems.length}, got ${containerIds.length}` 
        };
      }

      // Wait for all containers to be ready
      for (const containerId of containerIds) {
        let status = "IN_PROGRESS";
        let attempts = 0;
        const maxAttempts = 30;
        
        while (status === "IN_PROGRESS" && attempts < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, 2000));
          const statusUrl = new URL(`https://graph.facebook.com/v18.0/${containerId}`);
          statusUrl.searchParams.set("access_token", accessToken);
          statusUrl.searchParams.set("fields", "status_code");
          if (appsecretProof) statusUrl.searchParams.set("appsecret_proof", appsecretProof);
          
          const statusResponse = await fetch(statusUrl.toString());
          const statusData = await statusResponse.json() as any;
          status = statusData.status_code;
          attempts++;
        }
        
        if (status !== "FINISHED") {
          return { success: false, error: `Carousel item processing timeout or failed` };
        }
      }

      // Create carousel container
      const carouselUrl = new URL(`https://graph.facebook.com/v18.0/${accountId}/media`);
      carouselUrl.searchParams.set("access_token", accessToken);
      if (appsecretProof) carouselUrl.searchParams.set("appsecret_proof", appsecretProof);

      // Validate container IDs before creating carousel
      if (containerIds.length < 2 || containerIds.length > 10) {
        logger.error("Instagram carousel invalid container count", {
          accountId,
          containerCount: containerIds.length,
        });
        return { 
          success: false, 
          error: `Invalid carousel container count: ${containerIds.length}. Must be between 2 and 10.` 
        };
      }
      
      const carouselPayload = {
        caption: caption || "", // Use truncated caption
        media_type: "CAROUSEL",
        children: containerIds.join(",")
      };
      
      logger.info("Creating Instagram carousel container", {
        accountId,
        containerCount: containerIds.length,
        children: containerIds.join(","),
        hasCaption: !!content.text,
      });

      const carouselResponse = await fetch(carouselUrl.toString(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(carouselPayload)
      });

      const carouselData = await carouselResponse.json() as any;
      if (!carouselResponse.ok) {
        logger.error("Instagram carousel container creation failed", {
          accountId,
          imageCount: imageItems.length,
          containerIds: containerIds,
          error: carouselData.error,
          errorCode: carouselData.error?.code,
          errorSubcode: carouselData.error?.error_subcode,
          errorType: carouselData.error?.type,
        });
        return { 
          success: false, 
          error: carouselData.error?.message || `Failed to create carousel container. Error code: ${carouselData.error?.code || "unknown"}. Type: ${carouselData.error?.type || "unknown"}` 
        };
      }

      // Publish the carousel
      const publishUrl = new URL(`https://graph.facebook.com/v18.0/${accountId}/media_publish`);
      publishUrl.searchParams.set("access_token", accessToken);
      publishUrl.searchParams.set("creation_id", carouselData.id);
      // Note: fields parameter is for GET requests, not POST. POST to media_publish returns id by default.
      if (appsecretProof) publishUrl.searchParams.set("appsecret_proof", appsecretProof);

      const publishResponse = await fetch(publishUrl.toString(), {
        method: "POST",
      });

      const publishData = await publishResponse.json() as any;
      if (!publishResponse.ok) {
        logger.error("Instagram carousel publish failed", {
          accountId,
          carouselId: carouselData.id,
          error: publishData.error,
          responseStatus: publishResponse.status,
          fullResponse: JSON.stringify(publishData),
        });
        return { success: false, error: publishData.error?.message || "Failed to publish carousel" };
      }

      // Verify we got a media ID - check multiple possible response formats
      const mediaId = publishData.id || publishData.data?.id || publishData.media_id;
      if (!mediaId) {
        logger.error("Instagram carousel publish succeeded but no media ID returned", {
          accountId,
          carouselId: carouselData.id,
          publishResponse: JSON.stringify(publishData),
          responseStatus: publishResponse.status,
          responseHeaders: Object.fromEntries(publishResponse.headers.entries()),
        });
        return { success: false, error: "Media ID is not available. Carousel publish may have succeeded but ID was not returned." };
      }

      logger.info("Instagram carousel published successfully", {
        accountId,
        carouselId: carouselData.id,
        mediaId: mediaId,
      });

      return { success: true, externalPostId: mediaId };
    } catch (error) {
      logger.error("Instagram publish error", error);
      return { success: false, error: error instanceof Error ? error.message : "Instagram publish failed" };
    }
  }

  private async publishToFacebook(
    pageId: string, 
    accessToken: string, 
    content: PostContent
  ): Promise<PublishResult> {
    try {
      const appsecretProof = this.getAppSecretProof(accessToken);

      // Verify the token works with the Page ID (basic validation)
      const verifyUrl = new URL(`https://graph.facebook.com/v18.0/${pageId}`);
      verifyUrl.searchParams.set("access_token", accessToken);
      verifyUrl.searchParams.set("fields", "id,name");
      if (appsecretProof) {
        verifyUrl.searchParams.set("appsecret_proof", appsecretProof);
      }

      const verifyResponse = await fetch(verifyUrl.toString());
      if (!verifyResponse.ok) {
        const verifyData = await verifyResponse.json() as any;
        logger.error("Facebook Page token validation failed", {
          pageId,
          error: verifyData.error,
          errorCode: verifyData.error?.code,
          errorSubcode: verifyData.error?.error_subcode,
        });
        
        // Check for specific error codes
        if (verifyData.error?.code === 200) {
          return {
            success: false,
            error: "This Facebook account is not a Page or the access token does not have the required permissions (pages_manage_posts, pages_read_engagement). Please reconnect your Facebook Page account.",
          };
        }
        
        return {
          success: false,
          error: verifyData.error?.message || "Failed to validate Facebook Page access. Please reconnect your Facebook Page account.",
        };
      }

      if (!content.mediaUrl && !content.mediaUrls && !content.text) {
        return { success: false, error: "Facebook post requires text or media" };
      }

      // Support multiple media or single media
      const mediaItems = content.mediaUrls && content.mediaUrls.length > 0
        ? content.mediaUrls
        : content.mediaUrl && content.mediaType
          ? [{ url: content.mediaUrl, type: content.mediaType }]
          : [];

      // Separate images and videos
      const imageItems = mediaItems.filter(m => m.type === "image");
      const videoItems = mediaItems.filter(m => m.type === "video");

      // Handle videos (single video only, videos take priority if mixed)
      // If there are images AND videos, prioritize images for multi-image posts
      // Only use video if it's the only media or explicitly a video post
      if (videoItems.length > 0 && imageItems.length === 0) {
        // Only videos, no images - post as video
        const videoItem = videoItems[0]; // Facebook supports single video per post
        const videoUrl = new URL(`https://graph.facebook.com/v18.0/${pageId}/videos`);
        videoUrl.searchParams.set("access_token", accessToken);
        if (appsecretProof) videoUrl.searchParams.set("appsecret_proof", appsecretProof);

        const videoData = {
          file_url: videoItem.url,
          description: content.text || "",
          published: true
        };

        const response = await fetch(videoUrl.toString(), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(videoData)
        });

        const data = await response.json() as any;
        if (!response.ok) {
          logger.error("Facebook video publish error", {
            pageId,
            error: data.error,
            errorCode: data.error?.code,
            errorSubcode: data.error?.error_subcode,
            mediaCount: videoItems.length,
          });
          
          if (data.error?.code === 200) {
            return {
              success: false,
              error: "Facebook requires posting as a Page, not as a user. Please reconnect your Facebook Page account with the required permissions.",
            };
          }
          
          return { success: false, error: data.error?.message || "Failed to publish video to Facebook" };
        }

        logger.info("Facebook video published successfully", {
          pageId,
          postId: data.id,
        });

        return { success: true, externalPostId: data.id };
      }

      // Handle images (single or multiple)
      // If we have images (even if videos are also present), post images
      // Facebook doesn't support mixed media in a single post
      if (imageItems.length > 0) {
        if (videoItems.length > 0) {
          logger.warn("Facebook post has both images and videos - posting images only", {
            pageId,
            imageCount: imageItems.length,
            videoCount: videoItems.length,
          });
        }
        // Upload photos first (published: false to get photo IDs)
        const uploadedPhotos = await Promise.all(
          imageItems.map(async (media, index) => {
            const photoUrl = new URL(`https://graph.facebook.com/v18.0/${pageId}/photos`);
            photoUrl.searchParams.set("access_token", accessToken);
            if (appsecretProof) photoUrl.searchParams.set("appsecret_proof", appsecretProof);

            logger.info("Uploading photo to Facebook", {
              pageId,
              photoIndex: index + 1,
              totalPhotos: imageItems.length,
              mediaUrl: media.url.substring(0, 150), // Log first 150 chars
            });

            const photoResponse = await fetch(photoUrl.toString(), {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                url: media.url,
                published: false
              })
            });

            const photoData = await photoResponse.json() as any;
            if (!photoResponse.ok) {
              logger.error("Facebook photo upload failed", {
                pageId,
                photoIndex: index + 1,
                error: photoData.error,
                errorCode: photoData.error?.code,
                errorSubcode: photoData.error?.error_subcode,
                mediaUrl: media.url.substring(0, 150),
                responseStatus: photoResponse.status,
              });
              throw new Error(photoData.error?.message || photoData.error?.error_user_msg || "Failed to upload photo");
            }

            if (!photoData.id) {
              logger.error("Facebook photo upload succeeded but no ID returned", {
                pageId,
                photoIndex: index + 1,
                response: photoData,
              });
              throw new Error("Photo upload succeeded but no photo ID was returned");
            }

            return { media_fbid: photoData.id };
          })
        );

        // Create post with attached media
        const feedUrl = new URL(`https://graph.facebook.com/v18.0/${pageId}/feed`);
        feedUrl.searchParams.set("access_token", accessToken);
        if (appsecretProof) feedUrl.searchParams.set("appsecret_proof", appsecretProof);

        const postData = {
          message: content.text || "",
          attached_media: uploadedPhotos,
          published: true
        };

        const response = await fetch(feedUrl.toString(), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(postData)
        });

        const data = await response.json() as any;
        if (!response.ok) {
          logger.error("Facebook feed publish error", {
            pageId,
            error: data.error,
            errorCode: data.error?.code,
            errorSubcode: data.error?.error_subcode,
            hasMedia: uploadedPhotos.length > 0,
          });
          
          if (data.error?.code === 200) {
            return {
              success: false,
              error: "Facebook requires posting as a Page, not as a user. Please reconnect your Facebook Page account with the required permissions (pages_manage_posts, pages_read_engagement).",
            };
          }
          
          return { success: false, error: data.error?.message || "Failed to publish to Facebook feed" };
        }

        logger.info("Facebook post published successfully", {
          pageId,
          postId: data.id,
          imageCount: uploadedPhotos.length,
          totalMediaItems: mediaItems.length,
        });

        return { success: true, externalPostId: data.id };
      }

      // Text-only post
      const feedUrl = new URL(`https://graph.facebook.com/v18.0/${pageId}/feed`);
      feedUrl.searchParams.set("access_token", accessToken);
      if (appsecretProof) feedUrl.searchParams.set("appsecret_proof", appsecretProof);

      const postData = {
        message: content.text || "",
        published: true
      };

      const response = await fetch(feedUrl.toString(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(postData)
      });

      const data = await response.json() as any;
      if (!response.ok) {
        logger.error("Facebook text-only publish error", {
          pageId,
          error: data.error,
          errorCode: data.error?.code,
          errorSubcode: data.error?.error_subcode,
        });
        
        if (data.error?.code === 200) {
          return {
            success: false,
            error: "Facebook requires posting as a Page, not as a user. Please reconnect your Facebook Page account with the required permissions (pages_manage_posts, pages_read_engagement).",
          };
        }
        
        return { success: false, error: data.error?.message || "Failed to publish to Facebook" };
      }

      logger.info("Facebook text post published successfully", {
        pageId,
        postId: data.id,
      });

      return { success: true, externalPostId: data.id };
    } catch (error) {
      logger.error("Facebook publish exception", error);
      return { success: false, error: error instanceof Error ? error.message : "Facebook publish failed" };
    }
  }

  private async publishToLinkedIn(
    personId: string, 
    accessToken: string, 
    content: PostContent
  ): Promise<PublishResult> {
    try {
      const postData: any = {
        author: `urn:li:person:${personId}`,
        lifecycleState: "PUBLISHED",
        specificContent: {
          "com.linkedin.ugc.ShareContent": {
            shareCommentary: {
              text: content.text
            },
            shareMediaCategory: content.mediaUrl ? "IMAGE" : "NONE"
          }
        },
        visibility: {
          "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC"
        }
      };

      if (content.mediaUrl && content.mediaType === "image") {
        // LinkedIn requires uploading media first, then referencing it
        // For simplicity, we'll just post text for now
        // TODO: Implement LinkedIn media upload flow
        postData.specificContent["com.linkedin.ugc.ShareContent"].shareMediaCategory = "NONE";
      }

      const response = await fetch(
        "https://api.linkedin.com/v2/ugcPosts",
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${accessToken}`,
            "Content-Type": "application/json",
            "X-Restli-Protocol-Version": "2.0.0"
          },
          body: JSON.stringify(postData)
        }
      );

      const data = await response.json() as any;
      if (!response.ok) {
        return { success: false, error: data.message || "Failed to publish to LinkedIn" };
      }

      return { success: true, externalPostId: data.id };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : "LinkedIn publish failed" };
    }
  }
}
