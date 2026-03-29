import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SocialMediaService } from './social-media.service';

@Injectable()
export class SocialMediaScheduler {
  constructor(private readonly socialMediaService: SocialMediaService) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async handleDueScheduledPosts() {
    await this.socialMediaService.processDueScheduledPosts();
  }
}
