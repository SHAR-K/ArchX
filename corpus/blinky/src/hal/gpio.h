#ifndef GPIO_H
#define GPIO_H
#define GPIO_PORT_A 0u
void gpio_init(unsigned port);
void gpio_write(unsigned port, int level);
unsigned gpio_ticks(void);
void gpio_reset_all(void);
#endif
