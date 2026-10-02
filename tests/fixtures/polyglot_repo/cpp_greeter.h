/**
 * Greets people by name.
 */
class Greeter {
public:
    const char *hello(const char *name) {
        return name;
    }

private:
    const char *helper() {
        return "unused";
    }
};
