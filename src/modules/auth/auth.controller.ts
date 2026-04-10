import { Body, Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { Public } from './public.decorator';

@ApiTags('Авторизация')
@Controller('/')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Public()
  @ApiOperation({ summary: 'Проверить токен' })
  @Post('/auth/check')
  check(@Body() body: { token: string }) {
    return this.authService.checkToken(body.token);
  }
}
