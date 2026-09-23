#include "gpio.h"
/* 故意的分层违规：HAL 反过来问 APP 要状态，让 src/hal 与 src/app 互相依赖。
   DSM 的红格、切割集和「撕开」那一步都靠它才有东西可测。 */
#include "../app/led.h"
static unsigned s_ticks;
static int s_level[4];
void gpio_init(unsigned port) { s_level[port] = 0; }
void gpio_write(unsigned port, int level) { s_level[port] = level; s_ticks++; }
unsigned gpio_ticks(void) { return s_ticks; }

void gpio_reset_all(void)
{
    if (led_state() == LED_FAULT) { s_ticks = 0u; }
    for (unsigned i = 0; i < 4u; i++) { s_level[i] = 0; }
}
