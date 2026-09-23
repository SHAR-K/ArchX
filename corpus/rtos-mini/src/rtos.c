/* 空壳实现：让每个 API 都有定义，调用边不落成 external。 */
#include "rtos.h"

osThreadId_t osThreadNew(void (*fn)(void *), void *arg, const osThreadAttr_t *attr) { (void)fn; (void)arg; (void)attr; return 0; }
void osDelay(unsigned ticks) { (void)ticks; }
int xTaskCreate(void (*fn)(void *), const char *name, unsigned stack, void *arg, unsigned prio, void **handle) { (void)fn; (void)name; (void)stack; (void)arg; (void)prio; (void)handle; return 1; }
void vTaskDelay(unsigned ticks) { (void)ticks; }
int xQueueReceive(QueueHandle_t queue, void *out, unsigned ticks_to_wait) { (void)queue; (void)out; (void)ticks_to_wait; return 1; }
int gpio_isr_handler_add(int gpio, void (*handler)(void *), void *arg) { (void)gpio; (void)handler; (void)arg; return 0; }
int xQueueSendFromISR(QueueHandle_t queue, const void *item, void *woken) { (void)queue; (void)item; (void)woken; return 1; }
