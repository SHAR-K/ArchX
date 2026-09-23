#include "led.h"
#include "gpio.h"
#include "events.h"

static led_ctx_t s_ctx;

void led_init(void) { gpio_init(GPIO_PORT_A); gpio_reset_all(); events_wait_button(); s_ctx.state = LED_OFF; s_ctx.since = 0; }

led_state_t led_state(void) { return s_ctx.state; }

void led_task(void)
{
    unsigned now = g_tick_ms;
    if (g_button_pressed) { g_button_pressed = 0; s_ctx.state = LED_OFF; }
    switch (s_ctx.state)
    {
    case LED_OFF:
        if (now - s_ctx.since > 10u) { gpio_write(GPIO_PORT_A, 1); s_ctx.state = LED_ON; s_ctx.since = now; }
        break;
    case LED_ON:
        if (now - s_ctx.since > 10u) { gpio_write(GPIO_PORT_A, 0); s_ctx.state = LED_OFF; s_ctx.since = now; }
        else if (now < s_ctx.since) { s_ctx.state = LED_FAULT; }
        break;
    case LED_FAULT:
        break;
    default:
        break;
    }
}
