/* 抢占式样例：三个任务、两种优先级写法、一个中断。
   - control：CMSIS-RTOS2 风格，优先级在属性结构体的 .priority 里（枚举常量，经 C 风格转换）
   - logger：FreeRTOS 风格，优先级是 tskIDLE_PRIORITY + 1（宏 + 字面量）
   - worker：事件驱动，阻塞在队列上；TIM_IRQHandler 往队列里发，是它的唤醒方
   共享变量 g_setpoint 由 control 写、logger 读；g_ticks 由中断写、control 读。 */
#include "rtos.h"

const osThreadAttr_t control_attributes = {
  .name = "control",
  .stack_size = 512 * 4,
  .priority = (osPriority_t) osPriorityHigh,
};

volatile unsigned g_ticks;
volatile int g_setpoint;
static QueueHandle_t s_events;

void control_task(void *arg) {
  (void)arg;
  for (;;) {
    g_setpoint = (int)(g_ticks & 0xff);
    osDelay(10);
  }
}

void logger_task(void *arg) {
  (void)arg;
  for (;;) {
    int snapshot = g_setpoint;
    (void)snapshot;
    vTaskDelay(50);
  }
}

void worker_task(void *arg) {
  (void)arg;
  int event;
  for (;;) {
    if (xQueueReceive(s_events, &event, portMAX_DELAY)) {
      g_setpoint += event;
    }
  }
}

void TIM_IRQHandler(void) {
  int event = 1;
  g_ticks++;
  xQueueSendFromISR(s_events, &event, 0);
}

int main(void) {
  osThreadNew(control_task, 0, &control_attributes);
  xTaskCreate(logger_task, "logger", 128, 0, tskIDLE_PRIORITY + 1, 0);
  xTaskCreate(worker_task, "worker", 128, 0, tskIDLE_PRIORITY + 2, 0);
  for (;;) { }
}
