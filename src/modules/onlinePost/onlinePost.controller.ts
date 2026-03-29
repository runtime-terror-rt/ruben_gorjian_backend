import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { SocialPlan } from '@prisma/client';
import { Roles } from 'src/common/decorator/rolesDecorator';
import { AuthGuard } from 'src/common/guards/auth/auth.guard';
import { ROLE } from 'src/user/entities/role.entity';
import { SocialMediaService } from './social-media.service';

@Controller('social-media')
export class SocialMediaController {
  constructor(private readonly socialMediaService: SocialMediaService) {}

  @Get('me')
  me() {
    return this.socialMediaService.me();
  }

  @Post('users')
  createUser(@Body('username') username: string) {
    return this.socialMediaService.createUser(username);
  }

  @UseGuards(AuthGuard)
  @Roles(ROLE.CUSTOMER, ROLE.ADMIN)
  @Post('platform/connect-link')
  connectLinkForLoggedUser(
    @Req() req: Request & { user: any },
    @Body('redirectUrl') redirectUrl: string,
    @Body('platform') platform: string,
    @Body('showCalendar') showCalendar?: boolean,
  ) {
    return this.socialMediaService.createConnectLinkForUser(req.user, {
      redirectUrl,
      platform,
      showCalendar,
    });
  }

  @UseGuards(AuthGuard)
  @Roles(ROLE.CUSTOMER, ROLE.ADMIN)
  @Post('publish-now')
  publishNow(
    @Req() req: Request & { user: any },
    @Body('platform') platform: string,
    @Body('title') title: string,
    @Body('mediaUrl') mediaUrl?: string,
    @Body('mediaUrls') mediaUrls?: string[],
    @Body('asyncUpload') asyncUpload?: boolean,
  ) {
    return this.socialMediaService.publishNowByUser(req.user, {
      platform,
      title,
      mediaUrl,
      mediaUrls,
      asyncUpload,
    });
  }

  @UseGuards(AuthGuard)
  @Roles(ROLE.CUSTOMER, ROLE.ADMIN)
  @Post('calendar/schedule')
  schedule(
    @Req() req: Request & { user: any },
    @Body('platform') platform: string,
    @Body('title') title: string,
    @Body('scheduledAt') scheduledAt: string,
    @Body('mediaUrl') mediaUrl?: string,
    @Body('mediaUrls') mediaUrls?: string[],
  ) {
    return this.socialMediaService.schedulePost(req.user, {
      platform,
      title,
      mediaUrl,
      mediaUrls,
      scheduledAt,
    });
  }

  @UseGuards(AuthGuard)
  @Roles(ROLE.CUSTOMER, ROLE.ADMIN)
  @Get('calendar/my')
  myCalendar(@Req() req: Request & { user: any }, @Query('month') month?: string) {
    return this.socialMediaService.getMyCalendar(req.user.id, month);
  }

  @UseGuards(AuthGuard)
  @Roles(ROLE.CUSTOMER, ROLE.ADMIN)
  @Get('calendar/:id')
  getScheduledPost(@Req() req: Request & { user: any }, @Param('id') id: string) {
    return this.socialMediaService.getScheduledPost(req.user, id);
  }

  @UseGuards(AuthGuard)
  @Roles(ROLE.CUSTOMER, ROLE.ADMIN)
  @Patch('calendar/:id/reschedule')
  rescheduleScheduledPost(
    @Req() req: Request & { user: any },
    @Param('id') id: string,
    @Body('scheduledAt') scheduledAt: string,
  ) {
    return this.socialMediaService.reschedulePost(req.user, id, scheduledAt);
  }

  @UseGuards(AuthGuard)
  @Roles(ROLE.CUSTOMER, ROLE.ADMIN)
  @Delete('calendar/:id')
  cancelScheduledPost(@Req() req: Request & { user: any }, @Param('id') id: string) {
    return this.socialMediaService.cancelScheduledPost(req.user, id);
  }

  @UseGuards(AuthGuard)
  @Roles(ROLE.CUSTOMER, ROLE.ADMIN)
  @Post('calendar/:id/retry')
  retryScheduledPost(
    @Req() req: Request & { user: any },
    @Param('id') id: string,
    @Body('scheduledAt') scheduledAt?: string,
  ) {
    return this.socialMediaService.retryFailedPost(req.user, id, scheduledAt);
  }

  @UseGuards(AuthGuard)
  @Roles(ROLE.ADMIN)
  @Get('calendar/admin/client')
  clientCalendar(
    @Req() req: Request & { user: any },
    @Query('clientId') clientId: string,
    @Query('month') month?: string,
  ) {
    return this.socialMediaService.getAdminClientCalendar(
      req.user,
      clientId,
      month,
    );
  }

  @UseGuards(AuthGuard)
  @Roles(ROLE.CUSTOMER, ROLE.ADMIN)
  @Get('platform/my-links')
  myPlatformLinks(@Req() req: Request & { user: any }) {
    return this.socialMediaService.getMyPlatformLinks(req.user.id);
  }

  @UseGuards(AuthGuard)
  @Roles(ROLE.ADMIN)
  @Patch('admin/plan')
  updatePlan(
    @Req() req: Request & { user: any },
    @Body('userId') userId: string,
    @Body('plan') plan: SocialPlan,
  ) {
    return this.socialMediaService.updatePlan(req.user, userId, plan);
  }

  @UseGuards(AuthGuard)
  @Roles(ROLE.CUSTOMER, ROLE.ADMIN)
  @Get('provider/calendar-link')
  providerCalendarLink(
    @Req() req: Request & { user: any },
    @Query('platform') platform?: string,
    @Query('redirectUrl') redirectUrl?: string,
  ) {
    return this.socialMediaService.getProviderCalendarLink(req.user, {
      platform,
      redirectUrl,
    });
  }

  @UseGuards(AuthGuard)
  @Roles(ROLE.CUSTOMER, ROLE.ADMIN)
  @Get('provider/calendar')
  providerCalendar(
    @Req() req: Request & { user: any },
    @Query('platform') platform?: string,
    @Query('month') month?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.socialMediaService.getProviderCalendar(req.user, {
      platform,
      month,
      from,
      to,
      page,
      limit,
    });
  }

  @Get('status')
  status(@Query('jobId') jobId?: string, @Query('requestId') requestId?: string) {
    return this.socialMediaService.status({ jobId, requestId });
  }
}
