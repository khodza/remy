import { Controller, Get, HttpStatus, Logger, Res } from '@nestjs/common';
import type { Response } from 'express';
import { HealthService, type HealthReport } from '../services/health.service';

/**
 * GET /api/v1/health, no auth. 200 when MongoDB and Telegram answer, 503
 * with the same per-check body when one does not (so load balancers and
 * Docker's HEALTHCHECK see the failure).
 */
@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(private readonly health: HealthService) {}

  @Get()
  async check(
    @Res({ passthrough: true }) res: Response,
  ): Promise<HealthReport> {
    const report = await this.health.check();
    if (report.status !== 'ok') {
      res.status(HttpStatus.SERVICE_UNAVAILABLE);
      this.logger.warn(
        `Unhealthy: mongo ${report.checks.mongo.status}, telegram ${report.checks.telegram.status}`,
      );
    }
    return report;
  }
}
