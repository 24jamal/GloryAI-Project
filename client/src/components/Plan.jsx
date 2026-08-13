import { useState } from 'react'
import axios from 'axios'
import toast from 'react-hot-toast'
import { Check, Crown } from 'lucide-react'
import { useAuth, useUser } from '@clerk/react'

const loadRazorpayCheckout = () => new Promise((resolve, reject) => {
    if (window.Razorpay) return resolve();

    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.onload = resolve;
    script.onerror = () => reject(new Error('Unable to load Razorpay Checkout.'));
    document.body.appendChild(script);
});

const Plan = () => {
    const [loading, setLoading] = useState(false)
    const { getToken } = useAuth()
    const { user } = useUser()
    const isPremium = user?.publicMetadata?.plan === 'premium'

    const startSubscription = async () => {
        try {
            setLoading(true)
            await loadRazorpayCheckout()

            const { data } = await axios.post('/api/subscriptions/create', {}, {
                headers: { Authorization: `Bearer ${await getToken()}` }
            })

            if (!data.success) throw new Error(data.message || 'Unable to start checkout.')
            if (data.alreadySubscribed) {
                toast.success('Your Premium subscription is already active.')
                return
            }

            const checkout = new window.Razorpay({
                key: data.key,
                subscription_id: data.subscriptionId,
                name: 'GloryAI',
                description: 'Premium monthly subscription',
                prefill: data.prefill,
                theme: { color: '#3C81F6' },
                handler: async (response) => {
                    try {
                        const verification = await axios.post('/api/subscriptions/verify', response, {
                            headers: { Authorization: `Bearer ${await getToken()}` }
                        })

                        if (!verification.data.success) throw new Error(verification.data.message)
                        await user?.reload()
                        toast.success(verification.data.message)
                    } catch (error) {
                        toast.error(error.response?.data?.message || error.message || 'Payment verification failed.')
                    }
                },
            })
            checkout.open()
        } catch (error) {
            toast.error(error.response?.data?.message || error.message || 'Unable to start checkout.')
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className='max-w-2xl mx-auto z-20 my-16 px-6'>

            <div className='text-center'>
                <h2 className='text-slate-700 text-[42px] font-semibold'>
                    Choose Your Plan
                </h2>

                <p className='text-gray-500 max-w-lg mx-auto'>Start for free and scale up as you grow.
                    Find the perfect plan for your content creation needs.
                </p>
            </div>
            <div className='mt-10 bg-white border border-gray-200 rounded-2xl p-7 shadow-sm'>
                <div className='flex items-start justify-between gap-4'>
                    <div>
                        <div className='flex items-center gap-2 text-primary font-semibold'>
                            <Crown className='w-5 h-5' /> Premium
                        </div>


                        {/* Price */}
                        <div className='mt-3'>
                            <span className='text-4xl font-bold text-slate-800'>₹100</span>
                            <span className='text-lg text-gray-500'> / month</span>
                        </div>
                        <p className='mt-2 text-sm text-gray-500'>Unlimited access to all AlchemistAI premium tools.</p>
                    </div>
                    <p className='text-lg font-semibold text-slate-700'>Monthly</p>
                </div>
                <ul className='mt-6 space-y-3 text-sm text-slate-600'>
                    <li className='flex gap-2'><Check className='w-4 text-green-600' /> AI image generation</li>
                    <li className='flex gap-2'><Check className='w-4 text-green-600' /> Background and object removal</li>
                    <li className='flex gap-2'><Check className='w-4 text-green-600' /> Resume review and more</li>
                </ul>
                <button onClick={startSubscription} disabled={loading || isPremium}
                    className='mt-8 w-full rounded-lg bg-primary py-3 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60'>
                    {isPremium ? 'Premium is active' : loading ? 'Opening secure checkout...' : 'Subscribe monthly'}
                </button>
            </div>

        </div>
    )
}

export default Plan
