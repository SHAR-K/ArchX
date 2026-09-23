#include "events.h"
/* 中断里直接点灯：和 led_task 共用同一个 HAL 函数 gpio_write。这是中断 × 任务在函数级
   碰头的最小形状，双根对比的矩阵靠它才有格子；gpio.c 里的 s_level / s_ticks 也因此被
   中断和任务同时触到。 */
#include "../hal/gpio.h"

volatile unsigned char g_button_pressed;
volatile unsigned g_tick_ms;

void SysTick_Handler(void)
{
    g_tick_ms++;
}

void BUTTON_IRQHandler(void)
{
    g_button_pressed = 1;
    gpio_write(GPIO_PORT_A, 1);
}

void events_wait_button(void)
{
    while (!g_button_pressed) { }
}
